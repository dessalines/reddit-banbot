tsc -p . && node dist/out-tsc/banbot.js \
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