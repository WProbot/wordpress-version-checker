import { Application } from 'probot';
import * as createScheduler from 'probot-scheduler';
import * as https from 'https';

const repos = require('../data/repos.json');

function createIssue(context, repo: Repo, testedVersion: string, latestVersion: string): void
{
	context.github.issues.create({
		owner: repo.owner,
		repo: repo.repo,
		title: "The plugin hasn't been tested with the latest version of WordPress",
		body: 'There is a new WordPress version that the plugin hasn\'t been tested with. Please test it and then change the "Tested up to" field in the plugin readme.\n\n**Tested up to:** ' + testedVersion + '\n**Latest version:** ' + latestVersion + '\n\nYou may then close this issue as it won\'t be done automatically.'
	});
}

function outdated(context, repo: Repo, testedVersion: string, latestVersion: string): void
{
	context.github.issues.listForRepo({
		owner: repo.owner,
		repo: repo.repo,
		creator: 'wordpress-version-checker[bot]'
	}).then(function(result): void {
		if(result.data.length === 0)
		{
			createIssue(context, repo, testedVersion, latestVersion);
		}
	}).catch(function(e): void {
		context.log('Couldn\'t list repository issues for repository ' + repo.owner + '/' + repo.repo + '. Error message: ' + e);
	});
}

function checkRepo(context, repo: Repo, latest: string): void
{
	context.github.repos.getContents(repo).then(function(result): void {
		const readme = Buffer.from(result.data.content, 'base64').toString();
		for(let line of readme.split('\n'))
		{
			if(line.startsWith('Tested up to:'))
			{
				const matches = line.match(/[^:\s]+/g);
				if(!matches)
				{
					context.log('Repository ' + repo.owner + '/' + repo.repo + ' doesn\'t have a valid readme at path ' + repo.path + '.')
					return;
				}
				const version = matches.pop();
				if(!version)
				{
					context.log('Repository ' + repo.owner + '/' + repo.repo + ' doesn\'t have a valid readme at path ' + repo.path + '.')
					return;
				}
				if(!latest.startsWith(version))
				{
					outdated(context, repo, version, latest);
					return;
				}
			}
		}
		context.log('Repository ' + repo.owner + '/' + repo.repo + ' doesn\'t have a valid readme at path ' + repo.path + '.')
	}).catch(function(e): void {
		context.log('Couldn\'t get the readme of repository ' + repo.owner + '/' + repo.repo + ' at path ' + repo.path +  '. Error message: ' + e);
	});
}

function checkRepos(context, latest: string): void
{
	for(var repo of repos)
	{
		checkRepo(context, repo, latest);
	}
}

function schedule(context): Promise<void>
{
	const options = {
		host: 'api.wordpress.org',
		path: '/core/stable-check/1.0/'
	};
	https.get(options, function(response): void {
		if(response.statusCode !== 200)
		{
			context.log('Failed to fetch latest WordPress version. Request status code: ' + response.statusCode);
			return;
		}
		response.setEncoding('utf8');
		let rawData = '';
		response.on('data', (chunk): void => { rawData += chunk; });
		response.on('end', (): void => {
			try {
				const list = JSON.parse(rawData);
				const latest = Object.keys(list).find((key): boolean => list[key] === 'latest');
				if(!latest)
				{
					context.log('Failed to fetch latest WordPress version. Couldn\'t find latest version');
					return;
				}
				checkRepos(context, latest);
			} catch(e) {
				context.log('Failed to fetch latest WordPress version. Exception: ' + e.message);
			}
		});
	}).on('error', function(e): void {
		context.log('Failed to fetch latest WordPress version. Exception: ' + e.message);
	});
	return Promise.resolve();
}

module.exports = (app: Application): void => {
	createScheduler(app, {
		delay: false,
		interval: 1000 * 60 * 60 * 24 // 1 day
	});
	app.on('schedule.repository', schedule);
};

