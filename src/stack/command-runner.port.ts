/**
 * Runs an external program (git, gh, glab) in the repository and returns its stdout; rejects when
 * it fails or is not installed. Injected so publishing can be tested and dry-run without a host.
 */
export type CommandRunner = (command: string, args: readonly string[]) => Promise<string>;
