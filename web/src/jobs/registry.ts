import { JobUsageError, type JobDefinition, type JobRegistry } from "./types";
import { syncSerieAFoundationJob } from "./football-sync";

export const productionJobRegistry: JobRegistry = createJobRegistry([
  syncSerieAFoundationJob,
]);

export function createJobRegistry(definitions: readonly JobDefinition[]): JobRegistry {
  const registry = new Map<string, JobDefinition>();

  for (const definition of definitions) {
    if (!definition.type) {
      throw new JobUsageError("Job definition type is required");
    }

    if (registry.has(definition.type)) {
      throw new JobUsageError(`Duplicate job type registered: ${definition.type}`);
    }

    registry.set(definition.type, definition);
  }

  return registry;
}

export function getJobDefinition(registry: JobRegistry, type: string): JobDefinition {
  const definition = registry.get(type);

  if (!definition) {
    throw new JobUsageError(`Unknown job type: ${type}`);
  }

  return definition;
}

export function listJobTypes(registry: JobRegistry): string[] {
  return [...registry.keys()].sort();
}
