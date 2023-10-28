import settings from '../settings';
import { GithubSettings } from './settings';
import * as utils from './utils';
import { Octokit as GitHubApi, RestEndpointMethodTypes } from '@octokit/rest';
import { Endpoints } from '@octokit/types';
import {
  GitlabHelper,
  GitLabIssue,
  GitLabMergeRequest,
  GitLabNote,
  GitLabUser,
} from './gitlabHelper';

type IssuesListForRepoResponseData =
  Endpoints['GET /repos/{owner}/{repo}/issues']['response']['data'];
type PullsListResponseData =
  Endpoints['GET /repos/{owner}/{repo}/pulls']['response']['data'];

type GitHubIssue = IssuesListForRepoResponseData[0];
type GitHubPullRequest = PullsListResponseData[0];

const gitHubLocation = 'https://github.com';

interface CommentImport {
  created_at?: string;
  body: string;
}

interface IssueImport {
  title: string;
  body: string;
  closed: boolean;
  assignee?: string;
  created_at?: string;
  updated_at?: string;
  milestone?: number;
  labels?: string[];
}

export interface MilestoneImport {
  id: number; // GitHub internal identifier
  iid: number; // GitLab external number
  title: string;
  description: string;
  state: string;
  due_date?: string;
}

export interface SimpleLabel {
  name: string;
  color: string;
  description: string;
}

export interface SimpleMilestone {
  number: number;
  title: string;
}

export class GithubHelper {
  githubApi: GitHubApi;
  githubUrl: string;
  githubOwner: string;
  githubOwnerIsOrg: boolean;
  githubToken: string;
  githubTokenOwner: string;
  githubRepo: string;
  githubTimeout?: number;
  gitlabHelper: GitlabHelper;
  repoId?: number;
  delayInMs: number;
  useIssuesForAllMergeRequests: boolean;
  milestoneMap?: Map<number, SimpleMilestone>;

  constructor(
    githubApi: GitHubApi,
    githubSettings: GithubSettings,
    gitlabHelper: GitlabHelper,
    useIssuesForAllMergeRequests: boolean
  ) {
    this.githubApi = githubApi;
    this.githubUrl = githubSettings.baseUrl
      ? githubSettings.baseUrl
      : gitHubLocation;
    this.githubOwner = githubSettings.owner;
    this.githubOwnerIsOrg = githubSettings.ownerIsOrg ?? false;
    this.githubToken = githubSettings.token;
    this.githubTokenOwner = githubSettings.token_owner;
    this.githubRepo = githubSettings.repo;
    this.githubTimeout = githubSettings.timeout;
    this.gitlabHelper = gitlabHelper;
    this.delayInMs = 2000;
    this.useIssuesForAllMergeRequests = useIssuesForAllMergeRequests;
  }

  /*
   ******************************************************************************
   ******************************** GET METHODS *********************************
   ******************************************************************************
   */

  /**
   * Store the new repo id
   */
  async registerRepoId() {
    try {
      await utils.sleep(this.delayInMs);
      let result = await this.githubApi.repos.get({
        owner: this.githubOwner,
        repo: this.githubRepo,
      });

      this.repoId = result.data.id;
    } catch (err) {
      console.error('Could not access GitHub repo');
      console.error(err);
      process.exit(1);
    }
  }

  // ----------------------------------------------------------------------------

  /**
   * Get a list of all GitHub milestones currently in new repo
   */
  async getAllGithubMilestones(): Promise<SimpleMilestone[]> {
    try {
      await utils.sleep(this.delayInMs);
      // get an array of GitHub milestones for the new repo
      let result = await this.githubApi.issues.listMilestones({
        owner: this.githubOwner,
        repo: this.githubRepo,
        state: 'all',
      });

      return result.data.map(x => ({ number: x.number, title: x.title }));
    } catch (err) {
      console.error('Could not access all GitHub milestones');
      console.error(err);
      process.exit(1);
    }
  }

  // ----------------------------------------------------------------------------

  /**
   * Get a list of all the current GitHub issues.
   * This uses a while loop to make sure that each page of issues is received.
   */
  async getAllGithubIssues() {
    let allIssues: IssuesListForRepoResponseData = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      await utils.sleep(this.delayInMs);
      // get a paginated list of issues
      const issues = await this.githubApi.issues.listForRepo({
        owner: this.githubOwner,
        repo: this.githubRepo,
        state: 'all',
        labels: 'gitlab merge request',
        per_page: perPage,
        page: page,
      });

      // if this page has zero issues then we are done!
      if (issues.data.length === 0) break;

      // join this list of issues with the master list
      allIssues = allIssues.concat(issues.data);

      // if there are strictly less issues on this page than the maximum number per page
      // then we can be sure that this is all the issues. No use querying again.
      if (issues.data.length < perPage) break;

      // query for the next page of issues next iteration
      page++;
    }

    return allIssues;
  }

  // ----------------------------------------------------------------------------

  /**
   * Get a list of all GitHub label names currently in new repo
   */
  async getAllGithubLabelNames() {
    try {
      await utils.sleep(this.delayInMs);
      // get an array of GitHub labels for the new repo
      let result = await this.githubApi.issues.listLabelsForRepo({
        owner: this.githubOwner,
        repo: this.githubRepo,
      });

      // extract the label name and put into a new array
      let labels = result.data.map(x => x.name);

      return labels;
    } catch (err) {
      console.error('Could not access all GitHub label names');
      console.error(err);
      process.exit(1);
    }
  }

  // ----------------------------------------------------------------------------

  /**
   * Gets a release by tag name
   * @param tag {string} - the tag name to search a release for
   * @returns
   */
  async getReleaseByTag(tag: string) {
    try {
      await utils.sleep(this.delayInMs);
      // get an existing release by tag name in github
      let result = await this.githubApi.repos.getReleaseByTag({
        owner: this.githubOwner,
        repo: this.githubRepo,
        tag: tag,
      });

      return result;
    } catch (err) {
      console.error('No existing release for this tag on github');
      return null;
    }
  }

  // ----------------------------------------------------------------------------

  /**
   * Creates a new release on github
   * @param tag_name {string} - the tag name
   * @param name {string} - title of the release
   * @param body {string} - description for the release
   */
  async createRelease(tag_name: string, name: string, body: string) {
    try {
      await utils.sleep(this.delayInMs);
      // get an array of GitHub labels for the new repo
      let result = await this.githubApi.repos.createRelease({
        owner: this.githubOwner,
        repo: this.githubRepo,
        tag_name,
        name,
        body,
      });

      return result;
    } catch (err) {
      console.error('Could not create release on github');
      console.error(err);
      return null;
    }
  }

  // ----------------------------------------------------------------------------

  /**
   * Get a list of all the current GitHub pull requests.
   * This uses a while loop to make sure that each page of issues is received.
   */
  async getAllGithubPullRequests() {
    let allPullRequests: PullsListResponseData = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      await utils.sleep(this.delayInMs);
      // get a paginated list of pull requests
      const pullRequests = await this.githubApi.pulls.list({
        owner: this.githubOwner,
        repo: this.githubRepo,
        state: 'all',
        per_page: perPage,
        page: page,
      });

      // if this page has zero PRs then we are done!
      if (pullRequests.data.length === 0) break;

      // join this list of PRs with the master list
      allPullRequests = allPullRequests.concat(pullRequests.data);

      // if there are strictly less PRs on this page than the maximum number per page
      // then we can be sure that this is all the PRs. No use querying again.
      if (pullRequests.data.length < perPage) break;

      // query for the next page of PRs next iteration
      page++;
    }

    return allPullRequests;
  }

  // ----------------------------------------------------------------------------

  /*
   ******************************************************************************
   ******************************** POST METHODS ********************************
   ******************************************************************************
   */
  userIsCreator(author: GitLabUser) {
    return (
      author &&
      ((settings.usermap &&
        settings.usermap[author.username as string] ===
          settings.github.token_owner) ||
        author.username === settings.github.token_owner)
    );
  }

  /**
   * Update the description of the repository on GitHub.
   * Replaces newlines and tabs with spaces. No attempt is made to remove e.g. Markdown
   * links or other special formatting.
   */
  async updateRepositoryDescription(description: string) {
    let props: RestEndpointMethodTypes['repos']['update']['parameters'] = {
      owner: this.githubOwner,
      repo: this.githubRepo,
      description: description?.replace(/\s+/g, ' ') || '',
    };
    return this.githubApi.repos.update(props);
  }

  /**
   * TODO description
   * @param milestones All GitHub milestones
   * @param issue The GitLab issue object
   */
  async createIssue(issue: GitLabIssue) {
    let bodyConverted = await this.convertIssuesAndComments(
      issue.description ?? '',
      issue,
      !this.userIsCreator(issue.author) || !issue.description
    );

    let props: RestEndpointMethodTypes['issues']['create']['parameters'] = {
      owner: this.githubOwner,
      repo: this.githubRepo,
      title: issue.title ? issue.title.trim() : '',
      body: bodyConverted,
    };

    props.assignees = this.convertAssignees(issue);
    props.milestone = this.convertMilestone(issue);
    props.labels = this.convertLabels(issue);

    await utils.sleep(this.delayInMs);

    if (settings.dryRun) return Promise.resolve({ data: issue });

    return this.githubApi.issues.create(props);
  }

  /**
   * Converts GitLab assignees to GitHub usernames, using settings.usermap
   */
  convertAssignees(item: GitLabIssue | GitLabMergeRequest): string[] {
    if (!item.assignees) return [];
    let assignees: string[] = [];
    for (let assignee of item.assignees) {
      let username: string = assignee.username as string;
      if (username === settings.github.username) {
        assignees.push(settings.github.username);
      } else if (settings.usermap && settings.usermap[username]) {
        assignees.push(settings.usermap[username]);
      }
    }
    return assignees;
  }

  /**
   * Returns the GitHub milestone id for a milestone GitLab property of an issue or MR
   *
   * Note that this requires milestoneMap to be built, either during migration
   * or read from GitHub using registerMilestoneMap()
   */
  convertMilestone(item: GitLabIssue | GitLabMergeRequest): number | undefined {
    if (!this.milestoneMap) throw Error('this.milestoneMap not initialised');
    if (!item.milestone) return undefined;

    for (let m of this.milestoneMap.values())
      if (m.title == item.milestone.title) return m.number;

    return undefined;
  }

  /**
   * Converts GitLab labels to GitHub labels.
   *
   * This also adds "has attachment" if the issue links to data.
   */
  convertLabels(item: GitLabIssue | GitLabMergeRequest): string[] {
    let labels: string[] = [];
    if (item.labels) {
      labels = item.labels.filter(l => {
        if (item.state !== 'closed') return true;

        let lower = l.toLowerCase();
        // ignore any labels that should have been removed when the issue was closed
        return lower !== 'doing' && lower !== 'to do';
      });
      if (settings.conversion.useLowerCaseLabels) {
        labels = labels.map((el: string) => el.toLowerCase());
      }
    }

    // If the item's description contains a url that contains "/uploads/",
    // it is likely to have an attachment
    if (
      item.description &&
      item.description.indexOf('/uploads/') > -1 &&
      !settings.s3
    ) {
      labels.push('has attachment');
    }

    return labels;
  }

  /**
   * Uses the preview issue import API to set creation date on issues and comments.
   * Also it does not notify assignees.
   *
   * See https://gist.github.com/jonmagic/5282384165e0f86ef105
   * @param milestones All GitHub milestones
   * @param issue The GitLab issue object
   */
  async importIssueAndComments(issue: GitLabIssue) {
    let bodyConverted = issue.isPlaceholder
      ? issue.description ?? ''
      : await this.convertIssuesAndComments(
          issue.description ?? '',
          issue,
          !this.userIsCreator(issue.author) || !issue.description
        );

    let props: IssueImport = {
      title: issue.title ? issue.title.trim() : '',
      body: bodyConverted,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      closed: issue.state === 'closed',
    };

    let assignees = this.convertAssignees(issue);
    props.assignee = assignees.length == 1 ? assignees[0] : undefined;
    props.milestone = this.convertMilestone(issue);
    props.labels = this.convertLabels(issue);

    if (settings.dryRun) return Promise.resolve({ data: issue });

    //
    // Issue comments
    //

    console.log('\tMigrating issue comments...');

    let comments: CommentImport[] = [];

    if (issue.isPlaceholder) {
      console.log(
        '\t...this is a placeholder issue, no comments are migrated.'
      );
    } else {
      let notes = await this.gitlabHelper.getIssueNotes(issue.iid);
      comments = await this.processNotesIntoComments(notes);
    }

    const issue_number = await this.requestImportIssue(props, comments);

    if (assignees.length > 1 && issue_number) {
      if (assignees.length > 10) {
        console.error(
          `Cannot add more than 10 assignees to GitHub issue #${issue_number}.`
        );
      } else {
        console.log(
          `Importing ${assignees.length} assignees for GitHub issue #${issue_number}`
        );
      }
      this.githubApi.issues.addAssignees({
        owner: this.githubOwner,
        repo: this.githubRepo,
        issue_number: issue_number,
        assignees: assignees,
      });
    }
  }

  /**
   *
   * @param notes
   * @returns Comments ready for requestImportIssue()
   */
  async processNotesIntoComments(
    notes: GitLabNote[]
  ): Promise<CommentImport[]> {
    if (!notes || !notes.length) {
      console.log(`\t...no comments available, nothing to migrate.`);
      return [];
    }

    let comments: CommentImport[] = [];

    // sort notes in ascending order of when they were created (by id)
    notes = notes.sort((a, b) => a.id - b.id);

    let nrOfMigratedNotes = 0;
    for (let note of notes) {
      if (this.checkIfNoteCanBeSkipped(note.body)) continue;

      let userIsPoster =
        (settings.usermap &&
          settings.usermap[note.author.username] ===
            settings.github.token_owner) ||
        note.author.username === settings.github.token_owner;

      comments.push({
        created_at: note.created_at,
        body: await this.convertIssuesAndComments(
          note.body,
          note,
          !userIsPoster || !note.body
        ),
      });

      nrOfMigratedNotes++;
    }

    console.log(
      `\t...Done creating comments (migrated ${nrOfMigratedNotes} comments, skipped ${
        notes.length - nrOfMigratedNotes
      } comments)`
    );
    return comments;
  }
  /**
   * Calls the preview API for issue importing
   *
   * @param issue Props for the issue
   * @param comments Comments
   * @returns GitHub issue number or null if import failed
   */
  async requestImportIssue(
    issue: IssueImport,
    comments: CommentImport[]
  ): Promise<number | null> {
    // create the GitHub issue from the GitLab issue
    let pending = await this.githubApi.request(
      `POST /repos/${settings.github.owner}/${settings.github.repo}/import/issues`,
      {
        issue: issue,
        comments: comments,
      }
    );

    let result = null;
    while (true) {
      await utils.sleep(this.delayInMs);
      result = await this.githubApi.request(
        `GET /repos/${settings.github.owner}/${settings.github.repo}/import/issues/${pending.data.id}`
      );
      if (
        result.data.status === 'imported' ||
        result.data.status === 'failed'
      ) {
        break;
      }
    }
    if (result.data.status === 'failed') {
      console.log('\tFAILED: ');
      console.log(result);
      console.log('\tERRORS:');
      console.log(result.data.errors);
      return null;
    }

    let issue_number = result.data.issue_url.split('/').splice(-1)[0];
    return issue_number;
  }

  // ----------------------------------------------------------------------------

  /**
   * TODO description
   */
  async createIssueComments(githubIssue: GitHubIssue, issue: GitLabIssue) {
    console.log('\tMigrating issue comments...');

    // retrieve any notes/comments associated with this issue
    if (issue.isPlaceholder) {
      console.log(
        '\t...this is a placeholder issue, no comments are migrated.'
      );
      return;
    }

    let notes = await this.gitlabHelper.getIssueNotes(issue.iid);

    // if there are no notes, then there is nothing to do!
    if (notes.length === 0) {
      console.log(`\t...no issue comments available, nothing to migrate.`);
      return;
    }

    // sort notes in ascending order of when they were created (by id)
    notes = notes.sort((a, b) => a.id - b.id);

    let nrOfMigratedNotes = 0;
    for (let note of notes) {
      const gotMigrated = await this.processNote(note, githubIssue);
      if (gotMigrated) nrOfMigratedNotes++;
    }

    console.log(
      `\t...Done creating issue comments (migrated ${nrOfMigratedNotes} comments, skipped ${
        notes.length - nrOfMigratedNotes
      } comments)`
    );
  }

  // ----------------------------------------------------------------------------

  /**
   * This function checks if a note needs to be processed or if it can be skipped.
   * A note can be skipped if it contains predefined terms (like 'Status changed to...')
   * or if it contains any value from settings.skipMatchingComments ->
   * Note that this is case insensitive!
   *
   */
  checkIfNoteCanBeSkipped(noteBody: string) {
    const stateChange =
      (/Status changed to .*/i.test(noteBody) &&
        !/Status changed to closed by commit.*/i.test(noteBody)) ||
      /^changed milestone to .*/i.test(noteBody) ||
      /^Milestone changed to .*/i.test(noteBody) ||
      /^(Re)*assigned to /i.test(noteBody) ||
      /^added .* labels/i.test(noteBody) ||
      /^Added ~.* label/i.test(noteBody) ||
      /^removed ~.* label/i.test(noteBody) ||
      /^mentioned in issue #\d+.*/i.test(noteBody) ||
      // /^marked this issue as related to #\d+/i.test(noteBody) ||
      /^mentioned in merge request !\d+/i.test(noteBody) ||
      /^changed the description.*/i.test(noteBody) ||
      /^changed title from.*to.*/i.test(noteBody);

    const matchingComment = settings.skipMatchingComments.reduce(
      (a, b) => a || new RegExp(b, 'i').test(noteBody),
      false
    );

    return stateChange || matchingComment;
  }

  // ----------------------------------------------------------------------------

  /*
   * Processes the current note.
   * This means, it either creates a comment in the github issue, or it gets skipped.
   * Return false when it got skipped, otherwise true.
   */
  async processNote(
    note: GitLabNote,
    githubIssue: Pick<GitHubIssue | GitHubPullRequest, 'number'>
  ) {
    if (this.checkIfNoteCanBeSkipped(note.body)) return false;

    let bodyConverted = await this.convertIssuesAndComments(note.body, note);

    await utils.sleep(this.delayInMs);

    if (settings.dryRun) return true;

    await this.githubApi.issues
      .createComment({
        owner: this.githubOwner,
        repo: this.githubRepo,
        issue_number: githubIssue.number,
        body: bodyConverted,
      })
      .catch(x => {
        console.error('could not create GitHub issue comment!');
        console.error(x);
        process.exit(1);
      });
    return true;
  }

  // ----------------------------------------------------------------------------

  /**
   * Update the issue state (i.e., closed or open).
   */
  async updateIssueState(githubIssue: GitHubIssue, issue: GitLabIssue) {
    // default state is open so we don't have to update if the issue is closed.
    if (issue.state !== 'closed' || githubIssue.state === 'closed') return;

    let props: RestEndpointMethodTypes['issues']['update']['parameters'] = {
      owner: this.githubOwner,
      repo: this.githubRepo,
      issue_number: githubIssue.number,
      state: issue.state,
    };

    await utils.sleep(this.delayInMs);

    if (settings.dryRun) return Promise.resolve();

    return await this.githubApi.issues.update(props);
  }

  // ----------------------------------------------------------------------------

  /**
   * Create a GitHub milestone from a GitLab milestone
   * @param milestone GitLab milestone data
   * @return Created milestone data (or void if debugging => nothing created)
   */
  async createMilestone(milestone: MilestoneImport): Promise<SimpleMilestone> {
    // convert from GitLab to GitHub
    let bodyConverted = await this.convertIssuesAndComments(
      milestone.description,
      milestone,
      false
    );

    let githubMilestone: RestEndpointMethodTypes['issues']['createMilestone']['parameters'] =
      {
        owner: this.githubOwner,
        repo: this.githubRepo,
        title: milestone.title,
        description: bodyConverted,
        state: milestone.state === 'active' ? 'open' : 'closed',
      };

    if (milestone.due_date) {
      githubMilestone.due_on = milestone.due_date + 'T00:00:00Z';
    }

    await utils.sleep(this.delayInMs);

    if (settings.dryRun) return Promise.resolve({ number: -1, title: 'DEBUG' });

    const created = await this.githubApi.issues.createMilestone(
      githubMilestone
    );

    return { number: created.data.number, title: created.data.title };
  }

  // ----------------------------------------------------------------------------

  /**
   * Create a GitHub label from a GitLab label
   */
  async createLabel(label: SimpleLabel) {
    // convert from GitLab to GitHub
    let githubLabel = {
      owner: this.githubOwner,
      repo: this.githubRepo,
      name: label.name,
      color: label.color.substring(1), // remove leading "#" because gitlab returns it but github wants the color without it
      description: label.description,
    };

    await utils.sleep(this.delayInMs);

    if (settings.dryRun) return Promise.resolve();
    // create the GitHub label
    return await this.githubApi.issues.createLabel(githubLabel);
  }

  // ----------------------------------------------------------------------------

  /**
   * Create a pull request, set its data, and set its comments
   * @param mergeRequest the GitLab merge request that we want to migrate
   */
  async createPullRequestAndComments(
    mergeRequest: GitLabMergeRequest
  ): Promise<void> {
    let pullRequestData = await this.createPullRequest(mergeRequest);

    // createPullRequest() returns an issue number if a PR could not be created and
    // an issue was created instead, and settings.useIssueImportAPI is true. In that
    // case comments were already added and the state is already properly set
    if (typeof pullRequestData === 'number' || !pullRequestData) return;

    let pullRequest = pullRequestData.data;

    // data is set to null if one of the branches does not exist and the pull request cannot be created
    if (pullRequest) {
      // Add milestones, labels, and other attributes from the Issues API
      await this.updatePullRequestData(pullRequest, mergeRequest);

      // add any comments/nodes associated with this pull request
      await this.createPullRequestComments(pullRequest, mergeRequest);

      // Make sure to close the GitHub pull request if it is closed or merged in GitLab
      await this.updatePullRequestState(pullRequest, mergeRequest);
    }
  }

  // ----------------------------------------------------------------------------

  /**
   * Create a pull request. A pull request can only be created if both the target and source branches exist on the GitHub
   * repository. In many cases, the source branch is deleted when the merge occurs, and the merge request may not be able
   * to be migrated. In this case, an issue is created instead with a 'gitlab merge request' label.
   * @param mergeRequest the GitLab merge request object that we want to duplicate
   * @returns {Promise<Promise<{data: null}>|Promise<Github.Response<Github.PullsCreateResponse>>|Promise<{data: *}>>}
   */
  async createPullRequest(mergeRequest: GitLabMergeRequest) {
    let canCreate = !this.useIssuesForAllMergeRequests;

    if (canCreate) {
      // Check to see if the target branch exists in GitHub - if it does not exist, we cannot create a pull request
      try {
        await this.githubApi.repos.getBranch({
          owner: this.githubOwner,
          repo: this.githubRepo,
          branch: mergeRequest.target_branch,
        });
      } catch (err) {
        let gitlabBranches = await this.gitlabHelper.getAllBranches();
        if (gitlabBranches.find(m => m.name === mergeRequest.target_branch)) {
          // Need to move that branch over to GitHub!
          console.error(
            `The '${mergeRequest.target_branch}' branch exists on GitLab but has not been migrated to GitHub. Please migrate the branch before migrating pull request #${mergeRequest.iid}.`
          );
          return Promise.resolve({ data: null });
        } else {
          console.error(
            `Merge request ${mergeRequest.iid} (target branch '${mergeRequest.target_branch}' does not exist => cannot migrate pull request, creating an issue instead.`
          );
          canCreate = false;
        }
      }
    }

    if (canCreate) {
      // Check to see if the source branch exists in GitHub - if it does not exist, we cannot create a pull request
      try {
        await this.githubApi.repos.getBranch({
          owner: this.githubOwner,
          repo: this.githubRepo,
          branch: mergeRequest.source_branch,
        });
      } catch (err) {
        let gitlabBranches = await this.gitlabHelper.getAllBranches();
        if (gitlabBranches.find(m => m.name === mergeRequest.source_branch)) {
          // Need to move that branch over to GitHub!
          console.error(
            `The '${mergeRequest.source_branch}' branch exists on GitLab but has not been migrated to GitHub. Please migrate the branch before migrating pull request #${mergeRequest.iid}.`
          );
          return Promise.resolve({ data: null });
        } else {
          console.error(
            `Pull request #${mergeRequest.iid} (source branch '${mergeRequest.source_branch}' does not exist => cannot migrate pull request, creating an issue instead.`
          );
          canCreate = false;
        }
      }
    }

    if (settings.dryRun) return Promise.resolve({ data: mergeRequest });

    if (canCreate) {
      let bodyConverted = await this.convertIssuesAndComments(
        mergeRequest.description,
        mergeRequest
      );

      // GitHub API Documentation to create a pull request: https://developer.github.com/v3/pulls/#create-a-pull-request
      let props = {
        owner: this.githubOwner,
        repo: this.githubRepo,
        title: mergeRequest.title.trim(),
        body: bodyConverted,
        head: mergeRequest.source_branch,
        base: mergeRequest.target_branch,
      };

      await utils.sleep(this.delayInMs);

      try {
        // try to create the GitHub pull request from the GitLab issue
        const response = await this.githubApi.pulls.create(props);
        return Promise.resolve(response);
      } catch (err) {
        if (err.status === 422) {
          console.error(
            `Pull request #${mergeRequest.iid} - attempt to create has failed, assume '${mergeRequest.source_branch}' has already been merged => cannot migrate pull request, creating an issue instead.`
          );
          // fall through to next section
        } else {
          throw err;
        }
      }
    }

    // Failing all else, create an issue with a descriptive title

    let mergeStr =
      '_Merges ' +
      mergeRequest.source_branch +
      ' -> ' +
      mergeRequest.target_branch +
      '_\n\n';
    let bodyConverted = await this.convertIssuesAndComments(
      mergeStr + mergeRequest.description,
      mergeRequest,
      !this.userIsCreator(mergeRequest.author) || !settings.useIssueImportAPI
    );

    if (settings.useIssueImportAPI) {
      let assignees = this.convertAssignees(mergeRequest);

      let props: IssueImport = {
        title: mergeRequest.title.trim() + ' - [' + mergeRequest.state + ']',
        body: bodyConverted,
        assignee: assignees.length > 0 ? assignees[0] : undefined,
        created_at: mergeRequest.created_at,
        updated_at: mergeRequest.updated_at,
        closed:
          mergeRequest.state === 'merged' || mergeRequest.state === 'closed',
        labels: ['gitlab merge request'],
      };

      console.log('\tMigrating pull request comments...');
      let comments: CommentImport[] = [];

      if (!mergeRequest.iid) {
        console.log(
          '\t...this is a placeholder for a deleted GitLab merge request, no comments are created.'
        );
      } else {
        let notes = await this.gitlabHelper.getAllMergeRequestNotes(
          mergeRequest.iid
        );
        comments = await this.processNotesIntoComments(notes);
      }

      return this.requestImportIssue(props, comments);
    } else {
      let props = {
        owner: this.githubOwner,
        repo: this.githubRepo,
        assignees: this.convertAssignees(mergeRequest),
        title: mergeRequest.title.trim() + ' - [' + mergeRequest.state + ']',
        body: bodyConverted,
      };

      // Add a label to indicate the issue is a merge request
      if (!mergeRequest.labels) mergeRequest.labels = [];
      mergeRequest.labels.push('gitlab merge request');

      return this.githubApi.issues.create(props);
    }
  }

  // ----------------------------------------------------------------------------

  /**
   * Create comments for the pull request
   * @param pullRequest the GitHub pull request object
   * @param mergeRequest the GitLab merge request object
   */
  async createPullRequestComments(
    pullRequest: Pick<GitHubPullRequest, 'number'>,
    mergeRequest: GitLabMergeRequest
  ): Promise<void> {
    console.log('\tMigrating pull request comments...');

    if (!mergeRequest.iid) {
      console.log(
        '\t...this is a placeholder for a deleted GitLab merge request, no comments are created.'
      );
      return Promise.resolve();
    }

    let notes = await this.gitlabHelper.getAllMergeRequestNotes(
      mergeRequest.iid
    );

    // if there are no notes, then there is nothing to do!
    if (notes.length === 0) {
      console.log(
        `\t...no pull request comments available, nothing to migrate.`
      );
      return;
    }

    // Sort notes in ascending order of when they were created (by id)
    notes = notes.sort((a, b) => a.id - b.id);

    let nrOfMigratedNotes = 0;
    for (let note of notes) {
      const gotMigrated = await this.processNote(note, pullRequest);
      if (gotMigrated) nrOfMigratedNotes++;
    }

    console.log(
      `\t...Done creating pull request comments (migrated ${nrOfMigratedNotes} pull request comments, skipped ${
        notes.length - nrOfMigratedNotes
      } pull request comments)`
    );
  }

  // ----------------------------------------------------------------------------

  /**
   * Update the pull request data. The GitHub Pull Request API does not supply mechanisms to set the milestone, assignee,
   * or labels; these data are set via the Issues API in this function
   * @param pullRequest the GitHub pull request object
   * @param mergeRequest the GitLab pull request object
   * @returns {Promise<Github.Response<Github.IssuesUpdateResponse>>}
   */
  async updatePullRequestData(
    pullRequest: Pick<GitHubPullRequest, 'number'>,
    mergeRequest: GitLabMergeRequest
  ) {
    let props: RestEndpointMethodTypes['issues']['update']['parameters'] = {
      owner: this.githubOwner,
      repo: this.githubRepo,
      issue_number: pullRequest.number,
    };

    props.assignees = this.convertAssignees(mergeRequest);
    props.milestone = this.convertMilestone(mergeRequest);
    props.labels = this.convertLabels(mergeRequest);

    return await this.githubApi.issues.update(props);
  }

  // ----------------------------------------------------------------------------

  /**
   * Update the pull request state
   * @param pullRequest GitHub pull request object
   * @param mergeRequest GitLab pull request object
   * @returns {Promise<Promise<Github.AnyResponse>|Github.Response<Github.PullsUpdateResponse>|Promise<void>>}
   */
  async updatePullRequestState(
    pullRequest: Pick<GitHubPullRequest, 'number' | 'state'>,
    mergeRequest: GitLabMergeRequest
  ) {
    if (
      mergeRequest.state === 'merged' &&
      pullRequest.state !== 'closed' &&
      !settings.dryRun
    ) {
      // Merging the pull request adds new commits to the tree; to avoid that, just close the merge requests
      mergeRequest.state = 'closed';
    }

    // Default state is open so we don't have to update if the request is closed
    if (mergeRequest.state !== 'closed' || pullRequest.state === 'closed')
      return;

    let props: RestEndpointMethodTypes['issues']['update']['parameters'] = {
      owner: this.githubOwner,
      repo: this.githubRepo,
      issue_number: pullRequest.number,
      state: mergeRequest.state,
    };

    await utils.sleep(this.delayInMs);

    if (settings.dryRun) {
      return Promise.resolve();
    }

    // Use the Issues API; all pull requests are issues, and we're not modifying any pull request-sepecific fields. This
    // then works for merge requests that cannot be created and are migrated as issues.
    return await this.githubApi.issues.update(props);
  }

  // ----------------------------------------------------------------------------

  /**
   * Creates issues extracting commments from gitlab notes
   * @param milestones GitHub milestones
   * @param issue GitLab issue
   */
  async createIssueAndComments(issue: GitLabIssue) {
    if (settings.useIssueImportAPI) {
      await this.importIssueAndComments(issue);
    } else {
      const githubIssueData = await this.createIssue(issue);
      const githubIssue = githubIssueData.data;
      // add any comments/notes associated with this issue
      await this.createIssueComments(
        githubIssue as GitHubIssue,
        issue as GitLabIssue
      );
      // make sure to close the GitHub issue if it is closed in GitLab
      await this.updateIssueState(
        githubIssue as GitHubIssue,
        issue as GitLabIssue
      );
    }
  }

  // ----------------------------------------------------------------------------

  // TODO fix unexpected type coercion risk
  /**
   * Converts issue body or issue comments from GitLab to GitHub. That means:
   * - (optionally) Adds a line at the beginning indicating which original user created the
   *   issue or the comment and when - because the GitHub API creates everything
   *   as the API user
   * - Changes username from GitLab to GitHub in "mentions" (@username)
   * - Changes milestone references to links
   * - Changes MR references to PR references, taking into account the changes
   *   in indexing due to GitHub PRs using following the same numbering as
   *   issues
   * - Changes issue numbers (necessary e.g. if dummy GH issues were not
   *   created for deleted GL issues).
   *
   * FIXME: conversion should be deactivated depending on the context in the
   *  markdown, e.g. strike-through text for labels, or code blocks for all
   *  references.
   *
   * @param str Body of the GitLab note
   * @param item GitLab item to which the note belongs
   * @param add_line Set to true to add the line with author and creation date
   */
  async convertIssuesAndComments(
    str: string,
    item: GitLabIssue | GitLabMergeRequest | GitLabNote | MilestoneImport,
    add_line: boolean = true
  ): Promise<string> {
    // A note on implementation:
    // We don't convert project names once at the beginning because otherwise
    // we would have to check whether "text#23" refers to issue 23 or not, and
    // so on for MRs, milestones, etc.
    // Instead we consider either project#issue or " #issue" with non-word char
    // before the #, and we do the same for MRs, labels and milestones.

    const repoLink = `${this.githubUrl}/${this.githubOwner}/${this.githubRepo}`;
    const hasUsermap =
      settings.usermap !== null && Object.keys(settings.usermap).length > 0;
    const hasInactiveUserSettingMap =
      settings.inactiveUserSettings?.inactiveUserMap !== null && 
      Object.keys(settings.inactiveUserSettings?.inactiveUserMap).length > 0;
    const hasProjectmap =
      settings.projectmap !== null &&
      Object.keys(settings.projectmap).length > 0;

    if (add_line) str = GithubHelper.addMigrationLine(str, item, repoLink);
    let reString = '';

    //
    // User name conversion
    //

    if (hasUsermap) {
      reString = '@' + Object.keys(settings.usermap).join('|@');
      str = str.replace(
        new RegExp(reString, 'g'),
        match => '@' + settings.usermap[match.substring(1)]
      );
    }

    //
    // Inactive User mentions
    //

    if (hasInactiveUserSettingMap) {
        reString = '@' + Object.keys(settings.inactiveUserSettings?.inactiveUserMap).join('|@');
        str = str.replace(
            new RegExp(reString, 'g'),
            match => `${settings.inactiveUserSettings?.prepend}${settings.inactiveUserSettings?.inactiveUserMap[match.substring(1)]} (${match.substring(1)})`
        );
    }

    //
    // Issue reference conversion
    //

    let issueReplacer = (match: string) => {
      // TODO: issueMap
      return '#' + match;
    };

    if (hasProjectmap) {
      reString =
        '(' + Object.keys(settings.projectmap).join(')#(\\d+)|(') + ')#(\\d+)';
      str = str.replace(
        new RegExp(reString, 'g'),
        (_, p1, p2) => settings.projectmap[p1] + '#' + issueReplacer(p2)
      );
    }
    reString = '(?<=\\W)#(\\d+)';
    str = str.replace(new RegExp(reString, 'g'), (_, p1) => issueReplacer(p1));

    //
    // Milestone reference replacement
    //

    let milestoneReplacer = (
      number: string = '',
      title: string = '',
      repo: string = ''
    ) => {
      let milestone: SimpleMilestone;
      if (this.milestoneMap) {
        if (number) {
          milestone = this.milestoneMap.get(parseInt(number));
        } else if (title) {
          for (let m of this.milestoneMap.values()) {
            if (m.title === title) {
              milestone = m;
              break;
            }
          }
        }
      }
      if (milestone) {
        const repoLink = `${this.githubUrl}/${this.githubOwner}/${
          repo || this.githubRepo
        }`;
        return `[${milestone.title}](${repoLink}/milestone/${milestone.number})`;
      }
      console.log(
        `\tMilestone '${number || title}' not found in milestone map.`
      );
      return `'Reference to deleted milestone ${number || title}'`;
    };

    if (hasProjectmap) {
      // Replace: project%"Milestone"
      reString =
        '(' +
        Object.keys(settings.projectmap).join(')%(".*?")|(') +
        ')%(".*?")';
      str = str.replace(
        new RegExp(reString, 'g'),
        (_, p1, p2) => `Milestone ${p2} in ${settings.projectmap[p1]}`
      );

      // Replace: project%nn
      reString =
        '(' + Object.keys(settings.projectmap).join(')%(\\d+)|(') + ')%(\\d+)';
      str = str.replace(
        new RegExp(reString, 'g'),
        (_, p1, p2) =>
          `[Milestone ${p2} in ${settings.projectmap[p1]}](${this.githubUrl}/${this.githubOwner}/${settings.projectmap[p1]})`
      );
    }
    // Replace: %"Milestone"
    reString = '(?<=\\W)%"(.*?)"';
    str = str.replace(new RegExp(reString, 'g'), (_, p1) =>
      milestoneReplacer('', p1)
    );

    // Replace: %nn
    reString = '(?<=\\W)%(\\d+)';
    str = str.replace(new RegExp(reString, 'g'), (_, p1) =>
      milestoneReplacer(p1, '')
    );

    //
    // Label reference conversion
    //

    // FIXME: strike through in markdown is done as in: ~this text~
    // These regexes will capture ~this as a label. If it is among the migrated
    // labels, then it will be linked.

    let labelReplacer = (label: string) => {};

    // // Single word named label
    // if (hasProjectmap) {
    //   const reChunk = '~([^~\\s\\.,;:\'"!@()\\\\\\[\\]])+(?=[^~\\w])';
    //   reString =
    //     '('
    //     + Object.keys(settings.projectmap).join(')' + reChunk + '|(')
    //     + ')'
    //     + reChunk;
    //   str = str.replace(new RegExp(reString, 'g'),
    //   (_, p1, p2) => )

    //   TODO
    // } else {
    //   ...
    // }

    // // Quoted named label
    // reString = '~"([^~"]|\\w)+"(?=[^~\\w])';

    //
    // MR reference conversion
    //
    // TODO

    str = await utils.migrateAttachments(
      str,
      this.githubApi,
      this.repoId,
      settings.s3,
      this.gitlabHelper
    );

    return str;
  }

  // ----------------------------------------------------------------------------

  /**
   * Adds a line of text at the beginning of a comment that indicates who, when
   * and from GitLab.
   */
  static addMigrationLine(str: string, item: any, repoLink: string): string {
    if (!item || !item.author || !item.author.username || !item.created_at) {
      return str;
    }

    const dateformatOptions: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    };

    const formattedDate = new Date(item.created_at).toLocaleString(
      'en-US',
      dateformatOptions
    );

    const attribution = `In GitLab by @${item.author.username} on ${formattedDate}`;
    const lineRef =
      item && item.position
        ? GithubHelper.createLineRef(item.position, repoLink)
        : '';
    const summary = attribution + (lineRef ? `\n\n${lineRef}` : '');

    return `${summary}\n\n${str}`;
  }

  /**
   * When migrating in-line comments to GitHub then creates a link to the
   * appropriate line of the diff.
   */
  static createLineRef(position, repoLink: string): string {
    if (
      !repoLink ||
      !repoLink.startsWith(gitHubLocation) ||
      !position ||
      !position.head_sha
    ) {
      return '';
    }
    const base_sha = position.base_sha;
    const head_sha = position.head_sha;
    var path = '';
    var line = '';
    var slug = '';
    if (
      (position.new_line && position.new_path) ||
      (position.old_line && position.old_path)
    ) {
      var side;
      if (!position.old_line || !position.old_path) {
        side = 'R';
        path = position.new_path;
        line = position.new_line;
      } else {
        side = 'L';
        path = position.old_path;
        line = position.old_line;
      }
      const crypto = require('crypto');
      const hash = crypto.createHash('md5').update(path).digest('hex');
      slug = `#diff-${hash}${side}${line}`;
    }
    // Mention the file and line number. If we can't get this for some reason then use the commit id instead.
    const ref = path && line ? `${path} line ${line}` : `${head_sha}`;
    return `Commented on [${ref}](${repoLink}/compare/${base_sha}..${head_sha}${slug})\n\n`;
  }

  /**
   * Meh...
   * @param milestoneMap
   */
  async registerMilestoneMap(milestoneMap?: Map<number, SimpleMilestone>) {
    if (milestoneMap) {
      this.milestoneMap = milestoneMap;
    } else if (!milestoneMap && !this.milestoneMap) {
      let milestoneData = await this.getAllGithubMilestones();
      this.milestoneMap = new Map<number, SimpleMilestone>();
      milestoneData.forEach(m => this.milestoneMap.set(m.number, m));
    }
  }

  /**
   * Deletes the GH repository, then creates it again.
   */
  async recreateRepo() {
    let params = {
      owner: this.githubOwner,
      repo: this.githubRepo,
    };

    try {
      console.log(`Deleting repo ${params.owner}/${params.repo}...`);
      await this.githubApi.repos.delete(params);
      console.log('\t...done.');
    } catch (err) {
      if (err.status == 404) console.log(' not found.');
      else console.error(`\n\tSomething went wrong: ${err}.`);
    }
    try {
      if (this.githubOwnerIsOrg) {
        console.log(`Creating repo in organisation ${this.githubOwner}/${this.githubRepo}...`);
        await this.githubApi.repos.createInOrg({
          org: this.githubOwner,
          name: this.githubRepo,
          private: true,
        });
      } else {
        console.log(`Creating repo ${this.githubTokenOwner}/${this.githubRepo}...`);
        await this.githubApi.repos.createForAuthenticatedUser({
          name: this.githubRepo,
          private: true,
        });
      }
      console.log('\t...done.');
    } catch (err) {
      console.error(`\n\tSomething went wrong: ${err}.`);
    }
    await utils.sleep(this.delayInMs);
  }
}
