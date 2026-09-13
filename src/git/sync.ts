import { getPrimaryEmployee, getProjectForEmployee, upsertKnowledgeItem } from "../knowledge/repository.js";
import { GitClient, type GitCommit } from "./client.js";

export interface GitSyncResult {
  repoPath: string;
  repoName: string;
  commits: number;
  message: string;
}

/** One commit -> one knowledge item, keyed on its hash so re-syncing is idempotent. */
function ingestCommit(commit: GitCommit, repoName: string, employeeId: string, projectId: string | null): void {
  const files = commit.filesChanged.slice(0, 12);
  const moreFiles = commit.filesChanged.length > files.length ? ` (+${commit.filesChanged.length - files.length} more)` : "";

  upsertKnowledgeItem({
    employeeId,
    projectId,
    type: "COMMIT",
    title: `${repoName}@${commit.shortHash} — ${commit.subject}`,
    content: [
      `Commit ${commit.shortHash} in ${repoName} by ${commit.author}: ${commit.subject}`,
      commit.body || null,
      files.length ? `Files: ${files.join(", ")}${moreFiles}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    sourceType: "GIT",
    sourceId: `${repoName}:${commit.hash}`,
    confidence: 1.0,
    // A local commit is a verifiable fact about what changed, same trust tier
    // as Jira — but it is still not the same as a Jira-tracked decision, so
    // context rendering keeps it in its own section (see context-builder.ts).
    verified: true,
    updatedAt: commit.date,
  });
}

/**
 * Pulls recent commits from a local repo path into the knowledge store.
 *
 * `since` defaults to the employee's OOO start so the demo only surfaces
 * "what changed while they were away" rather than the whole project history.
 */
export async function syncGitRepo(repoPath: string, since?: string | null): Promise<GitSyncResult> {
  const employee = getPrimaryEmployee();
  const project = getProjectForEmployee(employee.id);
  const client = new GitClient(repoPath);

  if (!(await client.isValidRepo())) {
    throw new Error(`"${repoPath}" is not a git working tree (or git is not on PATH).`);
  }

  const repoName = await client.repoName();
  const effectiveSince = since ?? employee.ooo_started_at ?? undefined;
  const commits = await client.recentCommits({ since: effectiveSince, maxCount: 50 });

  for (const commit of commits) {
    ingestCommit(commit, repoName, employee.id, project?.id ?? null);
  }

  return {
    repoPath,
    repoName,
    commits: commits.length,
    message: `Synced ${commits.length} commit(s) from ${repoName}${effectiveSince ? ` since ${effectiveSince}` : ""}.`,
  };
}
