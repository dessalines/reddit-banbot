# Reddit-Banbot

Reddit-Banbot is a reddit bot that can ban users from your community based on karma gained in unwanted communities. 

You provide it with:
- A list of the communities you dislike.
- A bad karma threshold gained in those communities.
- A subreddit you moderate.
- A sort order for threads to scan from that subreddit.
- A sort order for users comments (it only fetches 100, so either new or top comments)

## Running

`./run.sh` , or run the following command:

```sh
yarn && tsc -p . && node dist/out-tsc/banbot.js \
--clientId X \
--clientSecret X \
--username X \
--password X \
--badSubs={X1,X2} \     # {cringeanarchy, milliondollarextreme}
--subreddit X  \        # the subreddit this user is a moderator of
--threadSort X \        # hour, day, week, month, year, all
--userCommentSort X \   # new, top
--badKarma X \          # A minimum accumulated bad karma threshold
--banDuration X \       # Number of days
--save \                # Saves users, submissions, and ban report out to the saved folder
--dryRun                # optional, doesnt ban
```

## Requirements
- node, typescript, yarn

### Setup a reddit script client

*This is required to make API calls to reddit at the rate of at least 1 per second.*

- Go [here](https://www.reddit.com/prefs/apps)
- Click create another app
- Click personal use script
- Copy down the `client_id`, and `client_secret` for later use.



## Bugs and feature requests
Have a bug or a feature request? If your issue isn't [already listed](https://github.com/tchoulihan/reddit-banbot/issues/), then open a [new issue here](https://github.com/tchoulihan/reddit-banbot/issues/new).
