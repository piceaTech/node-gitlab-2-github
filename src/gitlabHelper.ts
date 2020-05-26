import { Gitlab } from '@gitbeaker/node';
import { GitlabSettings } from './settings';
import axios from 'axios';


export default class GitlabHelper {
  // Wait for this issue to be resolved
  // https://github.com/jdalrymple/gitbeaker/issues/793
  gitlabApi: InstanceType<typeof Gitlab>;

  gitlabUrl?: string;
  gitlabToken: string;
  gitlabProjectId: number;

  host: string;
  projectPath?: string;

  constructor(
    gitlabApi: InstanceType<typeof Gitlab>,
    gitlabSettings: GitlabSettings
  ) {
    this.gitlabApi = gitlabApi;
    this.gitlabUrl = gitlabSettings.url;
    this.gitlabToken = gitlabSettings.token;
    this.gitlabProjectId = gitlabSettings.projectId;
    this.host = gitlabSettings.url ? gitlabSettings.url : 'http://gitlab.com';
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
          projects[i]['description']
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
   * Stores project path in a field
   */
  async registerProjectPath(project_d: number) {
    try {
      const project = await this.gitlabApi.Projects.show(project_d);
      this.projectPath = project['path_with_namespace'];
    } catch (err) {
      console.error('An Error occured while fetching all GitLab projects:');
      console.error(err);
    }
  }

  /**
   * Gets all notes for a given issue.
   */
  async getIssueNotes(issueIid: number) {
    try {
      return (await this.gitlabApi.IssueNotes.all(
        this.gitlabProjectId,
        issueIid,
        {}
      )) as any[];
    } catch (err) {
      console.error(`Could not fetch notes for GitLab issue #${issueIid}.`);
      return [];
    }
  }

  /**
   * Gets attachment using http get
   */
  async getAttachment(relurl: string) {
    try {
      const host = this.host.endsWith('/') ? this.host : this.host + '/';
      const attachmentUrl = host + this.projectPath + relurl;
      const data = (await axios.get(attachmentUrl, {responseType: 'arraybuffer'})).data;
      return Buffer.from(data, 'binary')
    } catch (err) {
      console.error(`Could not download attachment #${relurl}.`);
      return null;
    }
  }

  /**
   * Gets all branches.
   */
  async getAllBranches() {
    return (await this.gitlabApi.Branches.all(this.gitlabProjectId)) as any[];
  }

  /**
   * Gets all notes for a given merge request.
   */
  async getAllMergeRequestNotes(pullRequestIid: number) {
    try {
      return (this.gitlabApi.MergeRequestNotes.all(
        this.gitlabProjectId,
        pullRequestIid,
        {}
      ) as any) as any[];
    } catch (err) {
      console.error(
        `Could not fetch notes for GitLab merge request #${pullRequestIid}.`
      );
      return [];
    }
  }
}
