import settings from '../settings';
import { GithubSettings } from './settings';
import * as utils from './utils';
import {Octokit as GitHubApi, RestEndpointMethodTypes} from '@octokit/rest';
import { IssuesListForRepoResponseData, PullsListResponseData } from "@octokit/types";
import GitlabHelper from './gitlabHelper';

const gitHubLocation = 'https://github.com';

export default class GithubHelper {
  githubApi: GitHubApi;
  githubUrl: string;
  githubOwner: string;
  githubToken: string;
  githubRepo: string;
  githubTimeout?: number;
  gitlabHelper: GitlabHelper;
  userProjectRegex: RegExp;
  repoId?: number;
  delayInMs: number;
  useIssuesForAllMergeRequests: boolean;

  constructor(githubApi: GitHubApi,
              githubSettings: GithubSettings,
              gitlabHelper: GitlabHelper,
              useIssuesForAllMergeRequests: boolean) {
    this.githubApi = githubApi;
    this.githubUrl = githubSettings.baseUrl
      ? githubSettings.baseUrl
      : gitHubLocation;
    this.githubOwner = githubSettings.owner;
    this.githubToken = githubSettings.token;
    this.githubRepo = githubSettings.repo;
    this.githubTimeout = githubSettings.timeout;
    this.gitlabHelper = gitlabHelper;
    // regex for converting user from GitLab to GitHub
    this.userProjectRegex = utils.generateUserProjectRegex();
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
      // get an array of GitHub milestones for the new repo
      let result = await this.githubApi.repos.get({
        owner: this.githubOwner,
        repo: this.githubRepo
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
  async getAllGithubMilestones() {
    try {
      await utils.sleep(this.delayInMs);
      // get an array of GitHub milestones for the new repo
      let result = await this.githubApi.issues.listMilestones({
        owner: this.githubOwner,
        repo: this.githubRepo,
        state: 'all',
      });

      // extract the milestone number and title and put into a new array
      const milestones = result.data.map(x => ({
        number: x.number,
        title: x.title,
      }));

      return milestones;
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

  /**
   * TODO description
   */
  async createIssue(milestones, issue) {
    let bodyConverted = await this.convertIssuesAndComments(issue.description, issue);

    let props : RestEndpointMethodTypes["issues"]["create"]["parameters"] = {
      owner: this.githubOwner,
      repo: this.githubRepo,
      title: issue.title.trim(),
      body: bodyConverted,
    };

    //
    // Issue Assignee
    //

    // If the GitLab issue has an assignee, make sure to carry it over -- but only
    // if the username is a valid GitHub username.
    if (issue.assignee) {
      props.assignees = [];
      if (issue.assignee.username === settings.github.username) {
        props.assignees.push(settings.github.username);
      } else if (
        settings.usermap &&
        settings.usermap[issue.assignee.username]
      ) {
        // get GitHub username name from settings
        props.assignees.push(settings.usermap[issue.assignee.username]);
      }
    }

    //
    // Issue Milestone
    //

    // if the GitLab issue has an associated milestone, make sure to attach it.
    if (issue.milestone) {
      let milestone = milestones.find(m => m.title === issue.milestone.title);
      if (milestone) {
        props.milestone = milestone.number;
      }
    }

    //
    // Issue Labels
    //

    // make sure to add any labels that existed in GitLab
    if (issue.labels) {
      props.labels = issue.labels.filter(l => {
        if (issue.state !== 'closed') return true;

        let lower = l.toLowerCase();
        // ignore any labels that should have been removed when the issue was closed
        return lower !== 'doing' && lower !== 'to do';
      });
    }

    //
    // Issue Attachments
    //

    // if the issue contains a url that contains "/uploads/", it is likely to
    // have an attachment. Therefore, add the "has attachment" label.
    if (props.body && props.body.indexOf('/uploads/') > -1 && !settings.s3) {
      props.labels.push('has attachment');
    }
    await utils.sleep(this.delayInMs);

    if (settings.debug) return Promise.resolve({ data: issue });
    // create the GitHub issue from the GitLab issue
    return this.githubApi.issues.create(props);
  }

  // ----------------------------------------------------------------------------

  /**
   * TODO description
   */
  async createIssueComments(githubIssue, issue) {
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
      if (gotMigrated) {
        nrOfMigratedNotes++;
      }
    }

    console.log(
      `\t...Done creating issue comments (migrated ${nrOfMigratedNotes} comments, skipped ${notes.length -
        nrOfMigratedNotes} comments)`
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
  checkIfNoteCanBeSkipped(noteBody) {
    const stateChange =
      (/Status changed to .*/i.test(noteBody) &&
        !/Status changed to closed by commit.*/i.test(noteBody)) ||
      /changed milestone to .*/i.test(noteBody) ||
      /Milestone changed to .*/i.test(noteBody) ||
      /Reassigned to /i.test(noteBody) ||
      /added .* labels/i.test(noteBody) ||
      /Added ~.* label/i.test(noteBody) ||
      /removed ~.* label/i.test(noteBody) ||
      /mentioned in issue.*/i.test(noteBody);

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
  async processNote(note, githubIssue) {
    if (this.checkIfNoteCanBeSkipped(note.body)) {
      // note will be skipped
      return false;
    } else {
      let bodyConverted = await this.convertIssuesAndComments(note.body, note);

      await utils.sleep(this.delayInMs);

      if (settings.debug) {
        return true;
      }

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
  }

  // ----------------------------------------------------------------------------

  /**
   * Update the issue state (i.e., closed or open).
   */
  async updateIssueState(githubIssue, issue) {
    // default state is open so we don't have to update if the issue is closed.
    if (issue.state !== 'closed' || githubIssue.state === 'closed') return;

    let props: RestEndpointMethodTypes["issues"]["update"]["parameters"] = {
      owner: this.githubOwner,
      repo: this.githubRepo,
      issue_number: githubIssue.number,
      state: issue.state,
    };

    await utils.sleep(this.delayInMs);

    if (settings.debug) {
      return Promise.resolve();
    }
    // make the state update
    return await this.githubApi.issues.update(props);
  }

  // ----------------------------------------------------------------------------

  /**
   * Create a GitHub milestone from a GitLab milestone
   */
  async createMilestone(milestone) {
    // convert from GitLab to GitHub
    let githubMilestone : RestEndpointMethodTypes["issues"]["createMilestone"]["parameters"] = {
      owner: this.githubOwner,
      repo: this.githubRepo,
      title: milestone.title,
      description: milestone.description,
      state: milestone.state === 'active' ? 'open' : 'closed',
    };

    if (milestone.due_date) {
      githubMilestone.due_on = milestone.due_date + 'T00:00:00Z';
    }

    await utils.sleep(this.delayInMs);

    if (settings.debug) return Promise.resolve();
    // create the GitHub milestone
    return await this.githubApi.issues.createMilestone(githubMilestone);
  }

  // ----------------------------------------------------------------------------

  /**
   * Create a GitHub label from a GitLab label
   */
  async createLabel(label) {
    // convert from GitLab to GitHub
    let githubLabel = {
      owner: this.githubOwner,
      repo: this.githubRepo,
      name: label.name,
      color: label.color.substr(1), // remove leading "#" because gitlab returns it but github wants the color without it
    };

    await utils.sleep(this.delayInMs);

    if (settings.debug) return Promise.resolve();
    // create the GitHub label
    return await this.githubApi.issues.createLabel(githubLabel);
  }

  // ----------------------------------------------------------------------------

  /**
   * Create a pull request, set its data, and set its comments
   * @param milestones a list of the milestones that exist in the GitHub repository
   * @param pullRequest the GitLab pull request that we want to migrate
   * @returns {Promise<void>}
   */
  async createPullRequestAndComments(milestones, pullRequest) {
    let githubPullRequestData = await this.createPullRequest(pullRequest);
    let githubPullRequest = githubPullRequestData.data;

    // data is set to null if one of the branches does not exist and the pull request cannot be created
    if (githubPullRequest) {
      // Add milestones, labels, and other attributes from the Issues API
      await this.updatePullRequestData(
        githubPullRequest,
        pullRequest,
        milestones
      );

      // add any comments/nodes associated with this pull request
      await this.createPullRequestComments(githubPullRequest, pullRequest);

      // Make sure to close the GitHub pull request if it is closed or merged in GitLab
      await this.updatePullRequestState(githubPullRequest, pullRequest);
    }
  }

  // ----------------------------------------------------------------------------

  /**
   * Create a pull request. A pull request can only be created if both the target and source branches exist on the GitHub
   * repository. In many cases, the source branch is deleted when the merge occurs, and the merge request may not be able
   * to be migrated. In this case, an issue is created instead with a 'gitlab merge request' label.
   * @param pullRequest the GitLab pull request object that we want to duplicate
   * @returns {Promise<Promise<{data: null}>|Promise<Github.Response<Github.PullsCreateResponse>>|Promise<{data: *}>>}
   */
  async createPullRequest(pullRequest) {
    let canCreate = !this.useIssuesForAllMergeRequests;

    if (canCreate) {
      // Check to see if the target branch exists in GitHub - if it does not exist, we cannot create a pull request
      try {
        await this.githubApi.repos.getBranch({
          owner: this.githubOwner,
          repo: this.githubRepo,
          branch: pullRequest.target_branch,
        });
      } catch (err) {
        let gitlabBranches = await this.gitlabHelper.getAllBranches();
        if (gitlabBranches.find(m => m.name === pullRequest.target_branch)) {
          // Need to move that branch over to GitHub!
          console.error(
            `The '${pullRequest.target_branch}' branch exists on GitLab but has not been migrated to GitHub. Please migrate the branch before migrating pull request #${pullRequest.iid}.`
          );
          return Promise.resolve({ data: null });
        } else {
          console.error(
            `Merge request ${pullRequest.iid} (target branch '${pullRequest.target_branch}' does not exist => cannot migrate pull request, creating an issue instead.`
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
          branch: pullRequest.source_branch,
        });
      } catch (err) {
        let gitlabBranches = await this.gitlabHelper.getAllBranches();
        if (gitlabBranches.find(m => m.name === pullRequest.source_branch)) {
          // Need to move that branch over to GitHub!
          console.error(
            `The '${pullRequest.source_branch}' branch exists on GitLab but has not been migrated to GitHub. Please migrate the branch before migrating pull request #${pullRequest.iid}.`
          );
          return Promise.resolve({ data: null });
        } else {
          console.error(
            `Pull request #${pullRequest.iid} (source branch '${pullRequest.source_branch}' does not exist => cannot migrate pull request, creating an issue instead.`
          );
          canCreate = false;
        }
      }
    }

    if (settings.debug) return Promise.resolve({ data: pullRequest });

    if (canCreate) {
      let bodyConverted = await this.convertIssuesAndComments(
        pullRequest.description,
        pullRequest
      );

      // GitHub API Documentation to create a pull request: https://developer.github.com/v3/pulls/#create-a-pull-request
      let props = {
        owner: this.githubOwner,
        repo: this.githubRepo,
        title: pullRequest.title.trim(),
        body: bodyConverted,
        head: pullRequest.source_branch,
        base: pullRequest.target_branch,
      };

      await utils.sleep(this.delayInMs);

      // create the GitHub pull request from the GitLab issue
      return this.githubApi.pulls.create(props);
    } else {
      // Create an issue with a descriptive title
      let mergeStr =
        '_Merges ' +
        pullRequest.source_branch +
        ' -> ' +
        pullRequest.target_branch +
        '_\n\n';
      let bodyConverted = await this.convertIssuesAndComments(
        mergeStr + pullRequest.description,
        pullRequest
      );
      let props = {
        owner: this.githubOwner,
        repo: this.githubRepo,
        title: pullRequest.title.trim() + ' - [' + pullRequest.state + ']',
        body: bodyConverted,
      };

      // Add a label to indicate the issue is a merge request
      pullRequest.labels.push('gitlab merge request');

      return this.githubApi.issues.create(props);
    }
  }

  // ----------------------------------------------------------------------------

  /**
   * Create comments for the pull request
   * @param githubPullRequest the GitHub pull request object
   * @param pullRequest the GitLab pull request object
   * @returns {Promise<void>}
   */
  async createPullRequestComments(githubPullRequest, pullRequest) {
    console.log('\tMigrating pull request comments...');

    if (!pullRequest.iid) {
      console.log(
        '\t...this is a placeholder for a deleted GitLab merge request, no comments are created.'
      );
      return Promise.resolve();
    }

    let notes = await this.gitlabHelper.getAllMergeRequestNotes(
      pullRequest.iid
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
      const gotMigrated = await this.processNote(note, githubPullRequest);
      if (gotMigrated) {
        nrOfMigratedNotes++;
      }
    }

    console.log(
      `\t...Done creating pull request comments (migrated ${nrOfMigratedNotes} pull request comments, skipped ${notes.length -
        nrOfMigratedNotes} pull request comments)`
    );
  }

  // ----------------------------------------------------------------------------

  /**
   * Update the pull request data. The GitHub Pull Request API does not supply mechanisms to set the milestone, assignee,
   * or labels; these data are set via the Issues API in this function
   * @param githubPullRequest the GitHub pull request object
   * @param pullRequest the GitLab pull request object
   * @param milestones a list of Milestones that exist in the GitHub repo
   * @returns {Promise<Github.Response<Github.IssuesUpdateResponse>>}
   */
  async updatePullRequestData(githubPullRequest, pullRequest, milestones) {
    let props: RestEndpointMethodTypes["issues"]["update"]["parameters"] = {
      owner: this.githubOwner,
      repo: this.githubRepo,
      issue_number: githubPullRequest.number || githubPullRequest.iid,
    };

    //
    // Pull Request Assignee
    //

    // If the GitLab merge request has an assignee, make sure to carry it over --
    // but only if the username is a valid GitHub username
    if (pullRequest.assignee) {
      props.assignees = [];
      if (pullRequest.assignee.username === settings.github.username) {
        props.assignees.push(settings.github.username);
      } else if (
        settings.usermap &&
        settings.usermap[pullRequest.assignee.username]
      ) {
        // Get GitHub username from settings
        props.assignees.push(settings.usermap[pullRequest.assignee.username]);
      }
    }

    //
    // Pull Request Milestone
    //

    // if the GitLab merge request has an associated milestone, make sure to attach it
    if (pullRequest.milestone) {
      let milestone = milestones.find(
        m => m.title === pullRequest.milestone.title
      );
      if (milestone) {
        props.milestone = milestone.number;
      }
    }

    //
    // Merge Request Labels
    //

    // make sure to add any labels that existed in GitLab
    if (pullRequest.labels) {
      props.labels = pullRequest.labels.filter(l => {
        if (pullRequest.state !== 'closed') return true;

        let lower = l.toLowerCase();
        // ignore any labels that should have been removed when the issue was closed
        return lower !== 'doing' && lower !== 'to do';
      });
    }

    return await this.githubApi.issues.update(props);
  }

  // ----------------------------------------------------------------------------

  /**
   * Update the pull request state
   * @param githubPullRequest GitHub pull request object
   * @param pullRequest GitLab pull request object
   * @returns {Promise<Promise<Github.AnyResponse>|Github.Response<Github.PullsUpdateResponse>|Promise<void>>}
   */
  async updatePullRequestState(githubPullRequest, pullRequest) {
    if (
      pullRequest.state === 'merged' &&
      githubPullRequest.state !== 'closed' &&
      !settings.debug
    ) {
      // Merging the pull request adds new commits to the tree; to avoid that, just close the merge requests
      pullRequest.state = 'closed';
    }

    // Default state is open so we don't have to update if the request is closed
    if (pullRequest.state !== 'closed' || githubPullRequest.state === 'closed')
      return;

    let props : RestEndpointMethodTypes["issues"]["update"]["parameters"] = {
      owner: this.githubOwner,
      repo: this.githubRepo,
      issue_number: githubPullRequest.number,
      state: pullRequest.state,
    };

    await utils.sleep(this.delayInMs);

    if (settings.debug) {
      return Promise.resolve();
    }

    // Use the Issues API; all pull requests are issues, and we're not modifying any pull request-sepecific fields. This
    // then works for merge requests that cannot be created and are migrated as issues.
    return await this.githubApi.issues.update(props);
  }

  // ----------------------------------------------------------------------------

  /**
   * TODO description
   */
  async createIssueAndComments(milestones, issue) {
    // create the issue in GitHub
    const githubIssueData = await this.createIssue(milestones, issue);
    const githubIssue = githubIssueData.data;

    // add any comments/notes associated with this issue
    await this.createIssueComments(githubIssue, issue);

    // make sure to close the GitHub issue if it is closed in GitLab
    await this.updateIssueState(githubIssue, issue);
  }

  // ----------------------------------------------------------------------------

  // TODO fix unexpected type coercion risk
  /**
   * Converts issue body and issue comments from GitLab to GitHub. That means:
   * - Add a line at the beginning indicating which original user created the
   *   issue or the comment and when - because the GitHub API creates everything
   *   as the API user
   * - Change username from GitLab to GitHub in "mentions" (@username)
   */

  async convertIssuesAndComments(str: string, item: any) {
    const repoLink = `${this.githubUrl}/${this.githubOwner}/${this.githubRepo}`;
    if (
      (!settings.usermap || Object.keys(settings.usermap).length === 0) &&
      (!settings.projectmap || Object.keys(settings.projectmap).length === 0)
    ) {
      return GithubHelper.addMigrationLine(str, item, repoLink);
    } else {
      // - Replace userids as defined in settings.usermap.
      //   They all start with '@' in the issues but we have them without in usermap
      // - Replace cross-project issue references. They are matched on org/project# so 'matched' ends with '#'
      //   They all have a '#' right after the project name in the issues but we have them without in projectmap
      let strWithMigLine = GithubHelper.addMigrationLine(str, item, repoLink);

      strWithMigLine = strWithMigLine.replace(
        this.userProjectRegex,
        matched => {
          if (matched.startsWith('@')) {
            // this is a userid
            return '@' + settings.usermap[matched.substr(1)];
          } else if (matched.endsWith('#')) {
            // this is a cross-project issue reference
            return (
              settings.projectmap[matched.substring(0, matched.length - 1)] +
              '#'
            );
          } else {
            // something went wrong, do nothing
            return matched;
          }
        }
      );

      if (settings.s3) {
        strWithMigLine = await utils.migrateAttachments(strWithMigLine, this.repoId, settings.s3, this.gitlabHelper);
      }

      return strWithMigLine;
    }
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

    const dateformatOptions = {
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
  static createLineRef(position, repoLink) {
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
      const hash = crypto
        .createHash('md5')
        .update(path)
        .digest('hex');
      slug = `#diff-${hash}${side}${line}`;
    }
    // Mention the file and line number. If we can't get this for some reason then use the commit id instead.
    const ref = path && line ? `${path} line ${line}` : `${head_sha}`;
    return `Commented on [${ref}](${repoLink}/compare/${base_sha}..${head_sha}${slug})\n\n`;
  }
}
