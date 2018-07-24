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
  threadSort: string = argv['threadSort'];
  badKarmaLimit: number = argv['badKarma'];
  banDuration: number = argv['banDuration'];
  save: boolean = argv['save'];
  userCommentSort: string = argv['userCommentSort'];

  submissionOptions: ListingOptions & { time?: Timespan } = {
    show: argv['sort'],
    time: argv['sort']
  };

  userOverviewOptions: any = {
    sort: this.userCommentSort,
    limit: 100
  };

  submissionList: Array<string> = [];
  submissionExcludeList: Array<string>;
  userList: Array<string> = [];
  userExcludeList: Array<string>;
  userBanList: Array<UserReport> = [];
  userBanExcludeList: Array<UserReport>;

  waitMS: number = 1100;

  constructor() {

    console.log(argv);

    if (argv.hasOwnProperty('subreddit')) {
      this.auth();
      this.initFiles();
      this.main();
    } else {
      console.log('You\'re missing an option: ' +
        '--clientId X \\n' +
        '--clientSecret X \\n' +
        '--username X \\n' +
        '--password X \\n' +
        '--badSubs={X1,X2} (example: {cringeanarchy, milliondollarextreme}\\n' +
        '--subreddit X \\n' +
        '--sort hour (example: hour, day, week, month, year, all) \\n' +
        '--badKarma X \\n' +
        '--save');
    }

  }

  async main() {
    await this.fillSubmissionList();
    await this.fillUserList();
    await this.fillBanList();
    await this.banUsers();
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
        this.userExcludeList = [];
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
      password: argv['password']
    });
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

    for (let user of this.userList) {
      await this.fetchUserCommentsBad(user).then(badKarma => {
        if (badKarma >= this.badKarmaLimit) {
          let userReport: UserReport = {
            user: user,
            badKarma: badKarma
          }
          this.pushUnique(this.userBanList, userReport);
          this.pushUnique(this.userBanExcludeList, userReport);
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

    for (let userReport of this.userBanList) {
      console.log('Banning:');
      console.log(userReport);

      let banMessage = "You have been banned from /r/" + this.subreddit +
        " for " + this.banDuration + " days" +
        " for having " + userReport.badKarma + " out of our limit of " + this.badKarmaLimit +
        " in these subreddits: " + this.badSubs;
      let banOptions: BanOptions = {
        name: userReport.user,
        banMessage: banMessage,
        banReason: banMessage,
      };
      console.log(banOptions);

    }

  }

  async fetchTopThreads() {
    console.log('Fetching top threads from r/' + this.subreddit + ' ...');
    await this.sleep(this.waitMS);

    return await this.r.getSubreddit(this.subreddit).getTop(this.submissionOptions)
      // Don't include the ones already saved
      .filter(thread => !this.submissionExcludeList.includes(thread.id))
      .map(thread => thread.id);
  }

  async fetchUsersFromThread(thread: string) {
    console.log('Fetching users from thread: ' + thread + ' ...');

    await this.sleep(this.waitMS);

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
      });

    return await users;

  }

  // Handles recursive replies
  recursiveReplyLoop(replies: Array<any>, users: Array<string>) {
    for (let reply of replies) {
      let replyAuthor = reply.author.name;
      this.pushUnique(users, replyAuthor);
      if (reply['replies'] !== null) {
        this.recursiveReplyLoop(reply['replies'], users);
      }
    }
  }

  async fetchUserCommentsBad(user: string) {
    console.log('Fetching comments from user: ' + user + ' ...');

    await this.sleep(this.waitMS);
    // https://www.reddit.com/dev/api#GET_user_{username}_comments
    return await this.r.getUser(user)
      .getOverview(this.userOverviewOptions)
      // .filter(i => i.banned_by.name != argv['username'])
      .filter(i => this.badSubs.includes(i.subreddit.display_name))
      .filter(i => !Object.keys(this.userBanExcludeList).includes(i.author.name))
      .map(i => i.score)
      // sum the upvotes in the bad subs
      .reduce((a, b) => a + b, 0);
  }

  pushUnique(list: Array<any>, item: any) {
    if (list.indexOf(item) === -1) {
      list.push(item);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

}

interface UserReport {
  user: string,
  badKarma: number
}

let b: Banbot = new Banbot();


