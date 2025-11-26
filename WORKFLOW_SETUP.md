# GitHub Actions Workflow Setup Instructions

Due to GitHub permissions, the workflow file needs to be added manually through the GitHub web interface.

## Steps to Add the Workflow

1. **Navigate to your repository**: Go to https://github.com/CelestialBrain/sis-scraper

2. **Create the workflows directory**:
   - Click on "Add file" → "Create new file"
   - In the filename field, type: `.github/workflows/scrape.yml`
   - GitHub will automatically create the nested directories

3. **Copy the workflow content**:
   - Open the `scrape.yml` file in this repository
   - Copy all its contents
   - Paste into the new file you created in step 2

4. **Commit the file**:
   - Scroll down and click "Commit new file"
   - Use commit message: "Add GitHub Actions workflow for automated scraping"

5. **Verify the workflow**:
   - Go to the "Actions" tab in your repository
   - You should see "AdDU Curriculum Scraper" workflow listed
   - Click "Run workflow" to test it manually

## What the Workflow Does

- **Automatic Schedule**: Runs every Sunday at midnight UTC
- **Manual Trigger**: Can be triggered manually from the Actions tab
- **Output**: Generates `addu_curriculum_database.csv` and uploads it as an artifact
- **Auto-commit**: Optionally commits the results back to the repository

## Alternative: Using GitHub CLI with Proper Permissions

If you have a GitHub Personal Access Token with `workflow` permissions, you can push the workflow file directly:

```bash
# Set up authentication with workflow permissions
gh auth login --scopes workflow

# Then push the workflow file
git add .github/workflows/scrape.yml
git commit -m "Add GitHub Actions workflow"
git push
```

## Troubleshooting

- **Workflow doesn't appear**: Make sure the file is in `.github/workflows/` directory
- **Workflow fails**: Check the Actions tab for error logs
- **Permission errors**: Ensure the repository has Actions enabled in Settings → Actions
