// Commits working-tree changes through GitHub's GraphQL API (createCommitOnBranch), so GitHub signs
// the commit and it shows as Verified; a plain `git push` from Actions would be unsigned.
// Used by .github/workflows/update.yml. Outside Actions (no GITHUB_REPOSITORY) it only lists what it would commit.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// trimEnd only: porcelain lines start with a status column that may be a space.
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trimEnd();
const changed = git('status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean);
if (!changed.length) {
  console.log('No changes');
  process.exit(0);
}

const additions = [];
const deletions = [];
for (const line of changed) {
  const path = line.slice(3);
  if (line.slice(0, 2).includes('D')) deletions.push({ path });
  else additions.push({ path, contents: readFileSync(path).toString('base64') });
}

const { GITHUB_REPOSITORY: repo, GITHUB_REF_NAME: branch, GITHUB_TOKEN: token } = process.env;
if (!repo) {
  for (const f of additions) console.log(`would add/update ${f.path}`);
  for (const f of deletions) console.log(`would delete ${f.path}`);
  process.exit(0);
}

const query = 'mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { url } } }';
const input = {
  branch: { repositoryNameWithOwner: repo, branchName: branch },
  expectedHeadOid: git('rev-parse', 'HEAD'),
  message: { headline: 'chore: update profile card and experiments' },
  fileChanges: { additions, deletions },
};
const res = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'jaredstarner-profile' },
  body: JSON.stringify({ query, variables: { input } }),
});
const body = await res.json();
if (!res.ok || body.errors) {
  console.error(JSON.stringify(body.errors ?? body, null, 2));
  process.exit(1);
}
console.log(`committed ${body.data.createCommitOnBranch.commit.url}`);
