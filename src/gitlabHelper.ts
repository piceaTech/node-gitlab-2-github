import { Gitlab } from '@gitbeaker/node';
import { GitlabSettings } from './settings';
import axios from 'axios';

export class GitlabHelper {
  // Wait for this issue to be resolved
  // https://github.com/jdalrymple/gitbeaker/issues/793
  gitlabApi: InstanceType<typeof Gitlab>;

  gitlabUrl?: string;
  gitlabToken: string;
  gitlabProjectId: number;
  sessionCookie: string;

  host: string;
  projectPath?: string;
  allBranches: any;

  constructor(
    gitlabApi: InstanceType<typeof Gitlab>,
    gitlabSettings: GitlabSettings
  ) {
    this.gitlabApi = gitlabApi;
    this.gitlabUrl = gitlabSettings.url;
    this.gitlabToken = gitlabSettings.token;
    this.gitlabProjectId = gitlabSettings.projectId;
    this.host = gitlabSettings.url ? gitlabSettings.url : 'http://gitlab.com';
    this.host = this.host.endsWith('/')
      ? this.host.substring(0, this.host.length - 1)
      : this.host;
    this.sessionCookie = gitlabSettings.sessionCookie;
    this.allBranches = null;
  }

  /**
   * List all projects that the GitLab user is associated with.
   */
  async listProjects() {
    try {
      const projects = await this.gitlabApi.Projects.all({ membership: true });

      // print each project with info
      for (let project of projects) {
        console.log(
          project.id.toString(),
          '\t',
          project.name,
          '\t--\t',
          project['description']
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
      const attachmentUrl = this.host + '/' + this.projectPath + relurl;
      const data = (
        await axios.get(attachmentUrl, {
          responseType: 'arraybuffer',
          headers: {
            // HACK: work around GitLab's API lack of GET for attachments
            // See https://gitlab.com/gitlab-org/gitlab/-/issues/24155
            Cookie: `_gitlab_session=${this.sessionCookie}`,
          },
        })
      ).data;
      return Buffer.from(data, 'binary');
    } catch (err) {
      console.error(`Could not download attachment #${relurl}.`);
      return null;
    }
  }

  /**
   * Gets all branches.
   */
  async getAllBranches() {
    if (!this.allBranches) {
      this.allBranches = await this.gitlabApi.Branches.all(
        this.gitlabProjectId
      );
    }
    return this.allBranches as any[];
  }

  /**
   * Gets all notes for a given merge request.
   */
  async getAllMergeRequestNotes(pullRequestIid: number) {
    try {
      return this.gitlabApi.MergeRequestNotes.all(
        this.gitlabProjectId,
        pullRequestIid,
        {}
      ) as any as any[];
    } catch (err) {
      console.error(
        `Could not fetch notes for GitLab merge request #${pullRequestIid}.`
      );
      return [];
    }
  }
}
