import * as snoowrap from 'snoowrap';
import * as fs from 'fs';
import { ListingOptions } from 'snoowrap/dist/objects';
import { Timespan, BanOptions } from 'snoowrap/dist/objects/Subreddit';

var argv = require('minimist')(process.argv.slice(2));

var userBanListFile = 'saved/report.json',
  submissionFile = 'saved/submissions.json',
  userListFile = 'saved/users.json';

// TODO remove all their comments from your sub too.
class Banbot {

  r: snoowrap;

  badSubs: Array<string> = argv['badSubs'];
  subreddit: string = argv['subreddit'];
  threadSort = argv['threadSort'];
  userCommentSort: string = argv['userCommentSort'];
  badKarmaLimit: number = argv['badKarma'];
  banDuration: number = argv['banDuration'];
  removeComments: boolean = argv['removeComments'];
  save: boolean = argv['save'];
  dryRun: boolean = argv['dryRun'];

  waitMS: number = 1100;

  submissionOptions: ListingOptions & { time?: Timespan } = {
    time: this.threadSort
  };

  userOverviewOptions: any = {
    sort: this.userCommentSort,
    limit: 100
  };

  snooWrapOptions: snoowrap.ConfigOptions = {
    continueAfterRatelimitError: true,
    requestDelay: this.waitMS
  }

  submissionList: Array<string> = [];
  submissionExcludeList: Array<string>;
  userList: Array<string> = [];
  userExcludeList: Array<string>;
  userBanList: Array<UserReport> = [];
  userBanExcludeList: Array<UserReport>;

  constructor() {

    console.log(argv);

    if (argv.hasOwnProperty('subreddit')) {
      this.auth();
      this.initFiles();
      this.main();
    } else {
      console.log('Goto https://github.com/dessalines/reddit-banbot for help');
    }

  }

  async main() {
    await this.fillSubmissionList();
    await this.fillAlreadyBannedList();
    await this.fillUserList();
    await this.fillBanList();
    await this.banUsers();
    // test banning a user
    // await this.banUser("Aro2220", 3591);
  }

  initFiles() {

    // Create or load the files
    if (this.save) {
      if (fs.existsSync(submissionFile)) {
        this.submissionExcludeList = JSON.parse(fs.readFileSync(submissionFile, 'utf8'));
      }
      if (this.submissionExcludeList == null) {
        this.submissionExcludeList = [];
      }
      if (fs.existsSync(userListFile)) {
        this.userExcludeList = JSON.parse(fs.readFileSync(userListFile, 'utf8'));
      }
      if (this.userExcludeList == null) {
        this.userExcludeList = ['AutoModerator'];
      }
      if (fs.existsSync(userBanListFile)) {
        this.userBanExcludeList = JSON.parse(fs.readFileSync(userBanListFile, 'utf8'));
      }
      if (this.userBanExcludeList == null) {
        this.userBanExcludeList = [];
      }
    } else {
      this.deleteFile(userBanListFile);
      this.deleteFile(submissionFile);
      this.deleteFile(userListFile);

      this.submissionExcludeList = [];
      this.userExcludeList = [];
      this.userBanExcludeList = [];
    }
  }

  deleteFile(path: fs.PathLike) {
    if (fs.existsSync(path)) {
      fs.unlinkSync(path);
    }
  }

  writeFile(path: fs.PathLike, data: any) {
    fs.writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
  }

  auth() {
    this.r = new snoowrap({
      userAgent: 'testapp',
      clientId: argv['clientId'],
      clientSecret: argv['clientSecret'],
      username: argv['username'],
      password: argv['password'],
    });
    this.r.config(this.snooWrapOptions);
  }



  async fillSubmissionList() {
    await this.fetchTopThreads().then(async threads => {
      for (let thread of threads) {
        this.pushUnique(this.submissionList, thread);
        this.pushUnique(this.submissionExcludeList, thread);
      }

      if (this.save) {
        this.writeFile(submissionFile, this.submissionExcludeList);
      }

    }).catch(e => {
      console.error(e.message);
    });


  }

  async fillAlreadyBannedList() {

    if (this.userBanExcludeList.length == 0) {
      console.log("Fetching initial banned users for " + this.subreddit + " ...");
      await this.r.getSubreddit(this.subreddit).getBannedUsers().fetchAll().forEach(u => {
        this.pushUniqueUserReport(this.userBanExcludeList, { user: u.name, badKarma: -1 });
      });
    }
  }

  async fillUserList() {

    for (let thread of this.submissionList) {
      await this.fetchUsersFromThread(thread).then(async users => {
        for (let user of users) {
          this.pushUnique(this.userList, user);
          this.pushUnique(this.userExcludeList, user);
        }
      }).catch(e => {
        console.error(e.message);
      });
    }
    if (this.save) {
      this.writeFile(userListFile, this.userExcludeList);
    }
  }

  async fillBanList() {

    // Removes the already banned users so they're not fetched again
    let filteredUserList = this.userList.filter(u =>
      !this.userBanExcludeList.map(ub => ub.user).includes(u));

    for (let user of filteredUserList) {
      await this.fetchUserCommentsBad(user).then(badKarma => {
        if (badKarma >= this.badKarmaLimit) {
          let userReport: UserReport = {
            user: user,
            badKarma: badKarma
          }
          this.pushUniqueUserReport(this.userBanList, userReport);
          this.pushUniqueUserReport(this.userBanExcludeList, userReport);
        }
      }).catch(e => {
        console.error(e.message);
      });;
    }

    // Sort the list
    this.userBanList.sort((a, b) => b.badKarma - a.badKarma);
    this.userBanExcludeList.sort((a, b) => b.badKarma - a.badKarma);

    if (this.save) {
      this.writeFile(userBanListFile, this.userBanExcludeList);
    }
  }

  async banUsers() {

    if (this.dryRun) {
      console.log("Not banning, but here's the list:");
      console.log(this.userBanList);
    } else {
      console.log('Banning users ... ');
      console.log(this.userBanList);
      for (let userReport of this.userBanList) {
        this.banUser(userReport.user, userReport.badKarma);
      }
    }

  }

  async banUser(username: string, badKarma: number) {

    let banMessage = "You have been banned from /r/" + this.subreddit +
      " for " + this.banDuration + " days" +
      " for having " + badKarma +
      " out of our limit of " + this.badKarmaLimit +
      " in these subreddits: " + this.badSubs;
    let banReason = this.badKarmaLimit + " karma in " + this.badSubs;
    let banOptions: BanOptions = {
      name: username,
      banMessage: banMessage,
      banReason: banReason,
      banNote: banMessage,
      duration: this.banDuration
    };

    // Ban the user
    this.r.getSubreddit(this.subreddit).banUser(banOptions).then(() => {
      console.log("Banned " + username + " from " + this.subreddit);
    });

    // Remove their comments
    if (this.removeComments) {
      this.r.getUser(username).getComments().fetchAll()
        .filter(c => c.subreddit.display_name.toLowerCase() === this.subreddit)
        .forEach(c => {
          c.remove().then(() => {
            console.log("Removed comment " + c.link_id + " by " + c.author.name + " from " + c.subreddit.display_name);
          });
        });
    }
  }

  async fetchTopThreads() {
    console.log('Fetching top threads from r/' + this.subreddit + ' ...');

    return await this.r.getSubreddit(this.subreddit).getTop(this.submissionOptions)
      // Don't include the ones already saved
      .filter(thread => !this.submissionExcludeList.includes(thread.id))
      .map(thread => thread.id);
  }

  async fetchUsersFromThread(thread: string) {
    console.log('Fetching users from thread: ' + thread + ' ...');

    let users: Array<string> = [];

    await this.r.getSubmission(thread)
      .expandReplies({ limit: Infinity, depth: Infinity })
      .then(async thread => {
        for (let comment of thread.comments) {
          let commentAuthor = comment.author.name;

          if (!this.userExcludeList.includes(commentAuthor)) {
            this.pushUnique(users, commentAuthor);
          }

          // Loop recursively over replies, adding them to the user list
          let replies = comment.replies;
          this.recursiveReplyLoop(replies, users);

        }
      }).catch(async e => {
        console.error(e.message);
      });

    return await users;

  }

  // Handles recursive replies
  recursiveReplyLoop(replies: Array<any>, users: Array<string>) {
    for (let reply of replies) {
      let replyAuthor = reply.author.name;
      if (!this.userExcludeList.includes(replyAuthor)) {
        this.pushUnique(users, replyAuthor);
      }

      if (reply['replies'] !== null) {
        this.recursiveReplyLoop(reply['replies'], users);
      }
    }
  }

  async fetchUserCommentsBad(user: string) {
    console.log('Fetching comments from user: ' + user + ' ...');

    // https://www.reddit.com/dev/api#GET_user_{username}_comments
    return await this.r.getUser(user)
      .getOverview(this.userOverviewOptions)
      // .filter(i => i.banned_by.name != argv['username'])
      .filter(i => this.badSubs.includes(i.subreddit.display_name.toLowerCase()))
      .map(i => i.score)
      // sum the upvotes in the bad subs
      .reduce((a, b) => a + b, 0);
  }

  pushUnique(list: Array<any>, item: any) {
    if (list.indexOf(item) === -1) {
      list.push(item);
    }
  }

  pushUniqueUserReport(list: Array<UserReport>, item: UserReport) {
    if (list.map(ur => ur.user).indexOf(item.user) === -1) {
      list.push(item);
    }
  }

}

interface UserReport {
  user: string,
  badKarma: number
}

let b: Banbot = new Banbot();

