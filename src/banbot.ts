import * as snoowrap from 'snoowrap';
import * as fs from 'fs';
import { ListingOptions } from 'snoowrap/dist/objects';
import { Timespan, BanOptions } from 'snoowrap/dist/objects/Subreddit';

var argv = require('minimist')(process.argv.slice(2));

var userBanListFile = 'saved/report.json',
  submissionFile = 'saved/submissions.json',
  userListFile = 'saved/users.json';

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
    // await this.banUser("Tiavor", 3591);
    // test fetching user karma
    // this.testBanUser();

  }

  initFiles() {

    // Create or load the files
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
        this.pushUniqueUserReport(this.userBanExcludeList, { user: u.name, totalBadKarma: -1 });
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

        let userReport: UserReport = this.convertToUserReport(user, badKarma);
        if (userReport.totalBadKarma >= this.badKarmaLimit) {

          this.pushUniqueUserReport(this.userBanList, userReport);
          this.pushUniqueUserReport(this.userBanExcludeList, userReport);
        }
      }).catch(e => {
        console.error(e.message);
      });
    }

    // Sort the list
    this.userBanList.sort((a, b) => b.totalBadKarma - a.totalBadKarma);
    this.userBanExcludeList.sort((a, b) => b.totalBadKarma - a.totalBadKarma);

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
        await this.banUser(userReport);
      }
    }

  }

  async banUser(userReport: UserReport) {


    let duration: string = (!this.banDuration) ? " permanently " : " for " + this.banDuration + " days";

    let banMessage = "You have been banned from /r/" + this.subreddit + duration +
      " for having " + userReport.totalBadKarma + " karma" +
      " out of our limit of " + this.badKarmaLimit +
      ". Report: " + JSON.stringify(userReport) +
      ". If this post history does not describe who you are now, you may appeal this ban.";

    // The ban reason and note can't be longer than 300 chars
    let banReason = userReport.totalBadKarma + "/" + this.badKarmaLimit + " karma in reactionary subreddits.";
    let banOptions: BanOptions = {
      name: userReport.user,
      banMessage: banMessage,
      banReason: banReason,
      banNote: banReason
    };

    if (this.banDuration) {
      banOptions.duration = this.banDuration;
    }

    console.log(banMessage);

    // Ban the user
    await this.r.getSubreddit(this.subreddit).banUser(banOptions).then(async () => {
      console.log("Banned " + userReport.user + " from " + this.subreddit);
    }).catch(e => {
      console.error(e.message);
    });

    // Remove their comments
    if (this.removeComments) {
      await this.r.getUser(userReport.user).getComments().fetchAll()
        .filter(c => c.subreddit.display_name.toLowerCase() === this.subreddit)
        .forEach(async c => {
          await c.remove().then(() => {
            console.log("Removed comment " + c.link_id + " by " + c.author.name + " from " + c.subreddit.display_name);
          }).catch(e => {
            console.error(e.message);
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
      .fetchAll() // Fetches all the users comments now
      .filter(i => this.badSubs.includes(i.subreddit.display_name.toLowerCase()))
      .reduce((result, item) => {
        let key = item.subreddit.display_name.toLowerCase();
        result[key] = (result[key] === undefined) ? item.score : result[key] + item.score;
        return result;
      }, {});
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

  sumTotalBadKarma(badKarma: any): number {
    return Object.keys(badKarma)
      .reduce((sum, key) => {
        return sum + badKarma[key];
      }, 0);
  }

  convertToArrayOfBadKarma(badKarma: any): Array<BadKarma> {
    let bk: Array<BadKarma> = [];
    for (const key of Object.keys(badKarma)) {
      bk.push({ subreddit: key, badKarma: badKarma[key] });
    }
    return bk;
  }

  convertToUserReport(user: string, badKarmaObj: any): UserReport {
    return {
      user: user,
      badKarma: this.convertToArrayOfBadKarma(badKarmaObj),
      totalBadKarma: this.sumTotalBadKarma(badKarmaObj)
    };
  }

  testBanUser() {
    this.fetchUserCommentsBad("mhc-ask").then(d => {
      let userReport = this.convertToUserReport("mhc-ask", d);
      console.log(userReport);
      this.banUser(userReport);
    });
  }

  convertBadKarmaOldFile() {
    let data: Array<{ user: string, badKarma: number }> = JSON.parse(fs.readFileSync(userBanListFile, 'utf8'));
    this.userBanExcludeList = [];
    for (let d of data) {
      console.log(d);
      this.userBanExcludeList.push({ user: d.user, totalBadKarma: d.badKarma });
    }
    this.writeFile('saved/report-replace.json', this.userBanExcludeList);
  }

}

interface UserReport {
  user: string,
  badKarma?: Array<BadKarma>;
  totalBadKarma: number;
}

interface BadKarma {
  subreddit: string;
  badKarma: number;
}


let b: Banbot = new Banbot();


