import * as settings from './settings';

export default class GitlabHelper {
  constructor(gitlabApi, gitlabSettings) {
    this.gitlabApi = gitlabApi;
    this.gitlabUrl = gitlabSettings.url;
    this.gitlabToken = gitlabSettings.token;
    this.gitlabProjectId = gitlabSettings.projectId;
  }

  /**
   * List all projects that the GitLab user is associated with.
   */
  async listProjects() {
    try {
      const projects = await this.gitlabApi.Projects.all({ membership: true });

      // print each project with info
      for (let i = 0; i < projects.length; i++) {
        console.log(
          projects[i].id.toString(),
          '\t',
          projects[i].name,
          '\t--\t',
          projects[i].description
        );
      }

      // instructions for user
      console.log('\n\n');
      console.log(
        'Select which project ID should be transported to github. Edit the settings.js accordingly. (gitlab.projectID)'
      );
      console.log('\n\n');
    } catch (err) {
      console.error('An Error occured while fetching all GitLab projects:');
      console.error(err);
    }
  }

  /**
   * Gets all notes for a given issue.
   */
  async getIssueNotes(issueIid) {
    try {
      return await this.gitlabApi.IssueNotes.all(
        this.gitlabProjectId,
        issueIid
      );
    } catch (err) {
      console.error(`Could not fetch notes for GitLab issue #${issueIid}.`);
      return [];
    }
  }

  /**
   * Gets all branches.
   */
  async getAllBranches() {
    return await this.gitlabApi.Branches.all(this.gitlabProjectId);
  }

  /**
   * Gets all notes for a given merge request.
   */
  async getAllMergeRequestNotes(pullRequestIid) {
    try {
      return this.gitlabApi.MergeRequestNotes.all(
        this.gitlabProjectId,
        pullRequestIid
      );
    } catch (err) {
      console.error(
        `Could not fetch notes for GitLab merge request #${pullRequestIid}.`
      );
      return [];
    }
  }
}
