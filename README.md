# node-gitlab-2-github

## Install

1. You need nodejs and npm installed
1. Clone this repo with `git clone https://github.com/piceaTech/node-gitlab-2-github.git`
1. `cd node-gitlab-2-github`
1. `npm i`

## Preliminaries

Before using this script, you must mirror your GitLab repo to your new GitHub repo. This can be done with the following steps:

```bash
# Clone the repo from GitLab using the `--mirror` option. This is like
# `--bare` but also copies all refs as-is. Useful for a full backup/move.
git clone --mirror git@your-gitlab-site.com:username/repo.git

# Change into newly created repo directory
cd repo

# Push to GitHub using the `--mirror` option.  The `--no-verify` option skips any hooks.
git push --no-verify --mirror git@github.com:username/repo.git

# Set push URL to the mirror location
git remote set-url --push origin git@github.com:username/repo.git

# To periodically update the repo on GitHub with what you have in GitLab
git fetch -p origin
git push --no-verify --mirror
```

After doing this, the autolinking of issues, commits, and branches will work. See **Usage** for next steps.

## Usage

The user must be a member of the project you want to copy or else you won't see it in the first step.

1. `cp sample_settings.ts settings.ts`
1. edit settings.ts
1. run `npm run start`

## Where to find info for the `settings.ts`

### gitlab

#### gitlab.url

The URL under which your gitlab instance is hosted. Default is the official `http://gitlab.com` domain.

#### gitlab.token

Go to [Settings / Access Tokens](https://gitlab.com/profile/personal_access_tokens). Create a new Access Token with `api` and `read_repository` scopes and copy that into the `settings.ts`

#### gitlab.projectID

Leave it null for the first run of the script. Then the script will show you which projects there are. Can be either string or number.

### github

#### github.baseUrl

Where is the github instance hosted? Default is the official `api.github.com` domain

#### github.owner

Under which organisation or user will the new project be hosted

#### github.token

Go to [Settings / Developer settings / Personal access tokens](https://github.com/settings/tokens). Generate a new token with `repo` scope and copy that into the `settings.ts`

#### github.repo

What is the name of the new repo

### s3 (optional)

S3 can be used to store attachments from issues. If omitted, `has attachment` label will be added to GitHub issue.

#### s3.accessKeyId and s3.secretAccessKey

AWS [credentials](https://docs.aws.amazon.com/general/latest/gr/aws-sec-cred-types.html#access-keys-and-secret-access-keys) that are used to copy attachments from GitLab into the S3 bucket.

IAM User who owns these credential must have [write permissions](https://docs.aws.amazon.com/AmazonS3/latest/dev/example-policies-s3.html#iam-policy-ex0) to the bucket.

#### s3.bucket

Existing bucket, with an appropriate security policy. One possible policy is to allow [public access](https://docs.aws.amazon.com/AmazonS3/latest/dev/WebsiteAccessPermissionsReqd.html).

#### transfer.milestones

If this is set to true (default) then the migration process will transfer milestones.

#### transfer.labels

If this is set to true (default) then the migration process will transfer labels.

#### transfer.issues

If this is set to true (default) then the migration process will transfer issues.

#### transfer.mergeRequests

If this is set to true (default) then the migration process will transfer merge requests.

#### debug

As default it is set to false. Doesn't fire the requests to github api and only does the work on the gitlab side to test for wonky cases before using up api-calls

#### usePlaceholderIssuesForMissingIssues

If this is set to true (default) then the migration process will automatically create empty dummy issues for every 'missing' GitLab issue (if you deleted an GitLab issue for example). Those issues will be closed on Github and they ensure, that the issue ids stay the same on both, GitLab and Github.

#### useReplacementIssuesForCreationFails

If this is set to true (default) then the migration process will automatically create so called "replacement-issues" for every issue where the migration fails. This replacement issue will be exactly the same, but the original description will be lost. In the future, the description of the replacement issue will also contain a link to the original issue on GitLab. This way users, who still have access to the GitLab repository can still view its content. However, this is still an open task. (TODO)

It would of course be better to find the cause for migration fails, so that no replacement issues would be needed. Finding the cause together with a retry-mechanism would be optimal, and will maybe come in the future - currently the replacement-issue-mechanism helps to keep things in order.

#### useIssuesForAllMergeRequests

If this is set to true (default is false) then all merge requests will be migrated as GitHub issues (rather than pull requests). This can be
used to sidestep the problem where pull requests are rejected by GitHub if the feature branch no longer exists or has been merged.

#### filterByLabel

Filters all merge requests and issues by these labels. The applicable values can be found in the Gitlab API documentation for [issues](https://docs.gitlab.com/ee/api/issues.html#list-project-issues) and [merge requests](https://docs.gitlab.com/ee/api/merge_requests.html#list-merge-requests) respectively. Default is `null` which returns all issues/merge requests.

#### skipMatchingComments

This is an array (empty per default) that may contain string values. Any note/comment in any issue, that contains one or more of those string values, will be skipped (meaining not migrated). Note that this is case insensitive, therefore the string value `foo` would also lead to skipping notes containing a (sub)string `FOO`.

Suggested values:

- `time spent`, since those kind of terms can be used in GitLab to track time, they are rather meaningless in Github though
- action entries, such as `changed the description`, `added 1 commit`, `mentioned in merge request`, etc as they are interpreted as comments

#### timeout

Timeout when communicating with github

#### mergeRequests

Object consisting of `logfile` and `log`. If `log` is set to true, then the merge requests are logged in the specified file and not migrated. Conversely, if `log` is set to false, then the merge requests are migrated to GitHub and not logged. If the source or target branches linked to the merge request have been deleted, the merge request cannot be migrated to a pull request; instead, an issue with a custom "gitlab merge request" tag is created with the full comment history of the merge request.

#### transferOnlyOpen

If set to true (default false), only active milestones, open issues and open merge requests are migrated.

#### createdAfter

If provided (expected in ISO 8601 format,e.g. 2019-03-15T08:00:00Z), issues/milestones/MRs created after this date are migrated.

#### updatedAfter

If provided (expected in ISO 8601 format,e.g. 2019-03-15T08:00:00Z), issues/milestones/MRs updated after this date are migrated.

### usermap

Maps the usernames from gitlab to github. If the assinee of the gitlab issue is equal to the one currently logged in github it will also get assigned without a usermap. The Mentions in issues will also be translated to the new github name.

### projectmap

When one renames the project while transfering so that the projects don't loose there links to the mentioned issues.

## Import limit

Because Github has a limit of 5000 Api requests per hour one has to watch out that one doesn't get over this limit. I transferred one of my project with it ~ 300 issues with ~ 200 notes. This totals to some 500 objects excluding commits which are imported through githubs importer. I never got under 3800 remaining requests (while testing it two times in one hour).

So the rule of thumb should be that one can import a repo with ~ 2500 issues without a problem.

## Bugs

### Issue migration fail

See section 'useReplacementIssuesForCreationFails' above for more infos!
One reason seems to be some error with `Octokit` (error message snippet: https://pastebin.com/3VNUNYLh)

### Milestone refs and issue refs

the milestone refs and issue refs do not seem to be rewritten properly at the
moment. specifically, milestones show up like `%4` in comments
and issue refs like `#42` do not remap to the `#42` from gitlab under the new
issue number in github. @ references are remapped properly (yay). If this is a
deal breaker, a large amount of the code to do this has been written it just
appears to no longer work in current form :(

## Feature suggestions / ideas

### Throttling mechanism

A throttling mechanism could maybe help to avoid api rate limit errors.
In some scenarios the ability to migrate is probably more important than the total
duration of the migration process. Some users may even be willing to accept a very long duration (> 1 day if necessary?), if they can get the migration done at all, in return.

### Make request run in parallel

Some requests could be run in parallel, to shorten the total duration. Currently all GitLab- and Github-Api-Requests are being run sequentially.
