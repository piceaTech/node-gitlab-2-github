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

1. `cp sample_settings.js settings.js`
1. edit settings.js
1. run `node index.js`

## Where to find info for the `settings.js`

### gitlab

#### gitlab.url

The URL under which your gitlab instance is hosted.

#### gitlab.token

Go to your settings. Open the Access Token tab. Create a new Access Token and copy that into the `settings.js`

#### gitlab.projectID

Leave it null for the first run of the script. Then the script will show you which projects there are.

### github

#### github.baseUrl

Where is the github instance hosted? Default is the official `api.github.com` domain

#### github.owner

Under which organisation or user will the new project be hosted

#### github.username

Go to your settings. Open the Access Token tab. Create a new Access Token and copy that into the `settings.js`

#### github.token

Go to [Settings / Developer settings / Personal access tokens](https://github.com/settings/tokens). Generate a new token and copy that into the `settings.js`

#### github.repo

What is the name of the new repo

#### debug

As default it is set to false. Doesn't fire the requests to github api and only does the work on the gitlabb side to test for wonky cases before using up api-calls

#### mergeRequests

Object consisting of `logfile` and `log`. If `log` is set to true, then the merge requests are logged in the specified file and not migrated. Conversely, if `log` is set to false, then the merge requests are migrated to GitHub and not logged. If the source or target branches linked to the merge request have been deleted, the merge request cannot be migrated to a pull request; instead, an issue with a custom "gitlab merge request" tag is created with the full comment history of the merge request.

### usermap

Maps the usernames from gitlab to github. If the assinee of the gitlab issue is equal to the one currently logged in github it will also get assigned without a usermap. The Mentions in issues will also be translated to the new github name.

### projectmap

When one renames the project while transfering so that the projects don't loose there links to the mentioned issues.

## Import limit

Because Github has a limit of 5000 Api requests per hour one has to watch out that one doesn't get over this limit. I transfered one of my project with it ~ 300 issues with ~ 200 notes. This totals to some 500 objects excluding commits which are imported through githubs importer. I never got under 3800 remaining requests (while testing it two times in one hour).

So the rule of thumb should be that one can import a repo with ~ 2500 issues without a problem.

## Bugs

the milestone refs and issue refs do not seem to be rewritten properly at the
moment. specifically, milestones show up like `%4` in comments
and issue refs like `#42` do not remap to the `#42` from gitlab under the new
issue number in github. @ references are remapped properly (yay). If this is a
deal breaker, a large amount of the code to do this has been written it just
appears to no longer work in current form :(
