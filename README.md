# node-gitlab-2-github

## Install
1. You need node/iojs and npm installed
1. clone this repo with `git clone https://github.com/piceaTech/node-gitlab-2-github.git`
1. `cd node-gitlab-2-github`
1. `npm i`

## Usage
1. `mv sample_settings.json settings.json`
1. edit settings.json
1. run `node index.js`


## Import limit
Because Github has a limit of 5000 Api requests per hour one has to watch out that one doesn't get over this limit. I transfered on of my project with it ~ 300 issues with ~ 200 notes. This totals to some 500 objects excluding commits which are imported through githubs importer. I never got under 3800 remaining requests (while testing it two times in one hour).

So the rule of thumb should be that one can import a repo with ~ 2500 issues without a problem.


