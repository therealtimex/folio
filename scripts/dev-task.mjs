import { execSync } from 'node:child_process';

// Helper to check for gh CLI
try {
  execSync('gh --version', { stdio: 'ignore' });
} catch (e) {
  console.error('Error: GitHub CLI (gh) is not installed. Please install it first: https://cli.github.com/');
  process.exit(1);
}

// Helper to check for gh auth
try {
  execSync('gh auth status', { stdio: 'ignore' });
} catch (e) {
  console.error('Error: GitHub CLI is not authenticated. Run "gh auth login" first.');
  process.exit(1);
}

const title = process.argv[2];
const body = process.argv.slice(3).join(' ');

if (!title) {
  console.error('Usage: npm run task "Task title" "Task description (optional)"');
  process.exit(1);
}

const label = 'agent-task';

// Create label if it doesn't exist
try {
  execSync(`gh label list | grep -q "${label}"`, { stdio: 'ignore' });
} catch (e) {
  console.log(`Creating label "${label}"...`);
  try {
    execSync(`gh label create ${label} --color "#5319e7" --description "Tasks for the Gemini agent to process"`, { stdio: 'inherit' });
  } catch (labelError) {
    // Label might have been created by another process or exist but grep failed
    console.warn(`Note: Could not create label "${label}", it may already exist or there was a permission issue.`);
  }
}

console.log(`Creating issue: ${title}...`);
try {
  const result = execSync(`gh issue create --title "${title}" --body "${body || 'No description provided.'}" --label "${label}"`, { encoding: 'utf8' }).trim();
  console.log(`
Successfully created issue: ${result}`);
  console.log(`Agent is now ready to pick up: ${title}`);
} catch (e) {
  console.error('Failed to create issue:', e.message);
  process.exit(1);
}
