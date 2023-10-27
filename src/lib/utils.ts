import debug from 'debug';
import { Router } from 'express';
import { globSync } from 'glob';
import NDK from '@nostr-dev-kit/ndk';

import Path from 'path';
import { Context } from '@type/request';

type RouteMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export const logger: debug.Debugger = debug(process.env.MODULE_NAME || '');
const log: debug.Debugger = logger.extend('lib:utils');
const warn: debug.Debugger = logger.extend('lib:utils:warn');

export class EmptyRoutesError extends Error {}
export class DuplicateRoutesError extends Error {}

const methods: RouteMethod[] = ['get', 'post', 'put', 'patch', 'delete'];
const filesWithExtensionsWithoutExtensions = (
  path: string,
  extensions: string[],
) => {
  const extensionsSet = new Set(
    extensions.map((extension) => `.${extension.toLowerCase()}`),
  );

  const allFiles: string[] = [];

  globSync('*', {
    withFileTypes: true,
    cwd: path,
    matchBase: true,
    nocase: true,
    nodir: true,
  }).map((value) => {
    const filePath = value.relative();
    const fileExtension = Path.extname(filePath).toLowerCase();

    if (extensionsSet.has(fileExtension)) {
      const fileBase = Path.basename(filePath);

      allFiles.push(
        Path.join(
          Path.dirname(filePath),
          fileBase.substring(0, fileBase.length - fileExtension.length),
        ),
      );
    }
  });

  return allFiles;
};

const findDuplicates = (values: string[]) => {
  const counter: { [key: string]: number } = {};
  const duplicates: string[] = [];

  values.forEach((value) => {
    counter[value] = (counter[value] ?? 0) + 1;
  });
  for (const key in counter) {
    if (1 < counter[key]) {
      duplicates.push(key);
    }
  }

  return duplicates;
};

export const setUpRoutes = (router: Router, path: string): Router => {
  const allFiles = filesWithExtensionsWithoutExtensions(path, ['js', 'ts']);
  const duplicates = findDuplicates(allFiles);

  if (0 === allFiles.length) {
    throw new EmptyRoutesError();
  }

  if (duplicates.length) {
    throw new DuplicateRoutesError(`Duplicate routes: ${duplicates}`);
  }

  const routeHandlers = new Promise<Record<string, RouteMethod[]>>(
    (resolve, _reject) => {
      const allowedMethods: Record<string, RouteMethod[]> = {};
      allFiles.forEach(async (file, index, array) => {
        const matches = file.match(
          /^(?<route>.*)\/(?<method>get|post|put|patch|delete)$/i,
        );

        if (matches?.groups) {
          const method: RouteMethod = matches.groups.method as RouteMethod;
          const route: string = `/${matches.groups.route}`;

          router[method](
            route,
            (await require(Path.resolve(path, file))).default,
          );
          log(`Created ${method.toUpperCase()} route for ${route}`);
          if (undefined == allowedMethods[route]) {
            allowedMethods[route] = [];
          }
          allowedMethods[route].push(method);
        } else {
          warn(`Skipping ${file} as it doesn't comply to routes conventions.`);
        }
        if (index === array.length - 1) {
          resolve(allowedMethods);
        }
      });
    },
  );
  routeHandlers.then((allowedMethods) => {
    log('Allowed methods %O', allowedMethods);
    for (const route in allowedMethods) {
      const allowed = allowedMethods[route]
        .map((m) => m.toUpperCase())
        .join(', ');
      methods
        .filter((m) => !allowedMethods[route].includes(m))
        .forEach((m) => {
          router[m](route, (req, res) => {
            res.status(405).header('Allow', `OPTIONS, ${allowed}`).send();
          });
          log(`Created ${m.toUpperCase()} route for ${route}`);
        });
    }
  });

  return router;
};

export const setUpSubscriptions = (
  ctx: Context,
  ndk: NDK,
  path: string,
): NDK | null => {
  const allFiles = filesWithExtensionsWithoutExtensions(path, ['js', 'ts']);
  const duplicates = findDuplicates(allFiles);

  if (duplicates.length) {
    duplicates.forEach((duplicate) =>
      warn(`Found duplicate subscription ${duplicate}`),
    );
    return null;
  }

  allFiles.forEach(async (file) => {
    const matches = file.match(/^(?<name>[^/]*)$/i);

    if (matches?.groups) {
      let { filter, getHandler } = await require(Path.resolve(path, file));
      ndk
        .subscribe(filter, {
          closeOnEose: false,
        })
        .on('event', (event) => {
          try {
            getHandler(ctx, 0)(event);
          } catch (e) {
            warn(
              `Unexpected exception found when handling ${matches?.groups?.name}: %O`,
              e,
            );
          }
        });

      log(`Created ${matches.groups.name} subscription`);
    } else {
      warn(
        `Skipping ${file} as it doesn't comply to subscription conventions.`,
      );
    }
  });

  return ndk;
};

export const requiredEnvVar = (key: string): string => {
  const envVar = process.env[key];
  if (undefined === envVar) {
    throw new Error(`Environment process ${key} must be defined`);
  }
  return envVar;
};

export const requiredProp = <T>(obj: any, key: string): T => {
  if (obj[key] === undefined) {
    throw new Error(`Expected ${key} of ${obj} to be defined`);
  }
  return obj[key];
};

export const nowInSeconds = (): number => {
  return Math.round(Date.now() / 1000);
};

export const isEmpty = (obj: object): boolean => {
  return 0 === Object.keys(obj).length;
};

export function shuffled<T>(array: Array<T>): Array<T> {
  let result: Array<T> = Array.from(array);
  for (let i = result.length - 1; 0 < i; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
