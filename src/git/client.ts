/**
 * Local git log reader.
 *
 * Reads commit history from a working directory on disk with plain `git log` —
 * no GitHub/GitLab API, no auth, no network call. This is deliberately scoped
 * to "what changed locally while the employee was out" (the MEGAPROMPT's
 * feedback: local changes should also become knowledge), not a general git
 * hosting integration.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string; // ISO 8601
  subject: string;
  body: string;
  filesChanged: string[];
}

const FIELD_SEP = "\x1f"; // unit separator — won't collide with commit text
const RECORD_SEP = "\x1e"; // record separator between commits

export class GitClient {
  constructor(private readonly repoPath: string) {}

  /** True if repoPath exists and is inside a git working tree. */
  async isValidRepo(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: this.repoPath,
      });
      return stdout.trim() === "true";
    } catch {
      return false;
    }
  }

  /** Repo name, derived from the remote origin URL or the folder name. */
  async repoName(): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
        cwd: this.repoPath,
      });
      const url = stdout.trim();
      const match = url.match(/([^/\\]+?)(\.git)?$/);
      if (match) return match[1];
    } catch {
      /* no remote configured — fall through */
    }
    return this.repoPath.split(/[/\\]/).filter(Boolean).pop() ?? this.repoPath;
  }

  /**
   * Recent commits, newest first, including changed file names.
   * `since` accepts anything `git log --since` understands (e.g. "3 days ago",
   * an ISO date, or omitted for "since the employee went OOO").
   */
  async recentCommits(opts: { since?: string | null; maxCount?: number } = {}): Promise<GitCommit[]> {
    const format = `%H${FIELD_SEP}%h${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`;
    const args = ["log", `--pretty=format:${format}`, "--name-only", `-${opts.maxCount ?? 30}`];
    if (opts.since) args.push(`--since=${opts.since}`);

    const { stdout } = await execFileAsync("git", args, {
      cwd: this.repoPath,
      maxBuffer: 5 * 1024 * 1024,
    });

    return stdout
      .split(RECORD_SEP)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const [meta, ...fileLines] = chunk.split("\n");
        const [hash, shortHash, author, date, subject, ...bodyParts] = meta.split(FIELD_SEP);
        return {
          hash,
          shortHash,
          author,
          date,
          subject,
          body: bodyParts.join(FIELD_SEP).trim(),
          filesChanged: fileLines.map((l) => l.trim()).filter(Boolean),
        };
      });
  }
}
