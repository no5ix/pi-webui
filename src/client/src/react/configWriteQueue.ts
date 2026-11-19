export function createConfigWriteQueue<Scope, Config, Result>(
  read: (scope: Scope) => Promise<Config>,
  write: (scope: Scope, config: Config) => Promise<Result>,
): (scope: Scope, update: (current: Config) => Config) => Promise<Result> {
  let pending = Promise.resolve();
  return (scope, update) => {
    const operation = pending.then(async () => write(scope, update(await read(scope))));
    pending = operation.then(() => undefined, () => undefined);
    return operation;
  };
}
