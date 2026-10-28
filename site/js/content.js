// All game content lives here so it can be edited without touching game logic.
// Everything is fictional: no real members, balances, card numbers or accounts.

export const SEATS = ['member', 'front', 'network', 'core'];

export const SEAT_DEFAULT_LABEL = {
  member: 'Member',
  front: 'Front door',
  network: 'The network',
  core: 'Core system',
};

export const SEAT_ICON = { member: '🙋', front: '🏪', network: '🛰️', core: '🏦' };

// ─────────────────────────────────────────────────────────────
// MODULE 1 — ROUTE IT
// Each transaction walks through seats. Every step belongs to one seat.
// Options: ok = correct. end = finishes the transaction early with that outcome.
// ─────────────────────────────────────────────────────────────
export const TRANSACTIONS = [
  {
    id: 't1',
    title: 'Debit card tap at Foodland',
    amount: '$12.48',
    teaser: 'A normal Tuesday lunch.',
    labels: { member: 'Member', front: 'Store card reader', network: 'Card network & processor', core: 'MCFCU core system' },
    steps: [
      {
        seat: 'member',
        prompt: "You're buying lunch. The total is $12.48.",
        info: ['Payment: Maui County FCU debit card'],
        options: [
          { id: 'a', label: 'Tap the card on the reader', ok: true, fb: 'Tap. The chip creates a one-time code for this purchase, so a copied tap can’t be reused.' },
          { id: 'b', label: 'Read the card number out loud to the cashier', ok: false, fb: "Never say a full card number out loud. Anyone in line can hear it, and that's all a thief needs online." },
          { id: 'c', label: 'Tell the cashier your PIN so they can ring it up for you', ok: false, fb: 'Your PIN is yours alone. Nobody at a register ever needs to know it. You type it yourself, covered.' },
        ],
      },
      {
        seat: 'front',
        prompt: 'A card was just tapped. What do you do with it?',
        info: ['Amount: $12.48', 'Card ending: ••4417', 'Expires: 09/28', 'Issued by: Maui County FCU'],
        options: [
          { id: 'a', label: 'Send an approval request to the card network', ok: true, fb: 'Right. The store never decides. It asks.' },
          { id: 'b', label: "Approve it — it's only $12", ok: false, fb: "The store has no idea what's in the account or whether the card is stolen. Only the credit union can say yes." },
          { id: 'c', label: 'Call the credit union to check', ok: false, fb: 'Way too slow. This whole trip happens electronically in about 2 seconds.' },
          { id: 'd', label: "Approve it — the card hasn't expired", ok: false, fb: 'An unexpired card can still be reported lost, or have no money behind it. The expiration date is the one thing the store CAN see, and it isn’t enough.' },
        ],
      },
      {
        seat: 'network',
        prompt: 'An approval request just arrived from Foodland.',
        info: ['Amount: $12.48', 'Card ••4417 status: ACTIVE ✅', 'Card belongs to: Maui County FCU'],
        options: [
          { id: 'a', label: "Route it to MCFCU's core system", ok: true, fb: 'Yes. The network checks the card, then hands the money question to the credit union.' },
          { id: 'b', label: 'Approve it yourself', ok: false, fb: "The network checks the card and routes the request. It doesn't hold the member's money, so it can't approve." },
          { id: 'c', label: 'Check the balance, then approve', ok: false, fb: "The network can't see balances. Only the credit union's core knows what's in the account." },
          { id: 'd', label: 'Decline it', ok: false, fb: 'The card is active. No reason to decline here.' },
        ],
      },
      {
        seat: 'core',
        prompt: 'Approval request for $12.48. Check the account.',
        info: ['Member: Kalani A.', 'Available balance: $240.15', 'Holds: none'],
        task: 'Checked balance for transaction #1',
        options: [
          { id: 'a', label: 'Approve', ok: true, fb: 'Approved. The core subtracts $12.48 and sends "yes" back down the line.' },
          { id: 'b', label: 'Decline', ok: false, fb: 'They have $240.15 available. There’s no reason to decline.' },
          { id: 'c', label: 'Ask Foodland what was bought before deciding', ok: false, fb: "The core never sees what's in the bag, and doesn't need to. The question is only: is the money there?" },
        ],
      },
    ],
    outcome: {
      result: 'approved',
      headline: 'APPROVED in about 2 seconds',
      lesson: 'Four systems touched it. Foodland never saw the balance, and the core never saw what was in the lunch.',
    },
  },
  {
    id: 't2',
    title: 'Same card, two days later',
    amount: '$49.99',
    teaser: 'Longs Drugs. Something has changed…',
    labels: { member: 'Member', front: 'Store card reader', network: 'Card network & processor', core: 'MCFCU core system' },
    steps: [
      {
        seat: 'member',
        prompt: "Last night you couldn't find your debit card anywhere. What should you have done?",
        info: ['Card ending: ••4417', 'Last seen: yesterday afternoon'],
        options: [
          { id: 'a', label: 'Call MCFCU right away and report it lost', ok: true, fb: 'Yes. You did, at 9:14 PM. Watch what that one phone call does next.' },
          { id: 'b', label: "Wait a few days — it'll probably turn up", ok: false, fb: 'Every hour you wait is an hour someone else can use it. Report first; you can always get a new card.' },
          { id: 'c', label: 'Change your online banking password', ok: false, fb: "A good habit, but the card still works at a register. Only reporting it stops the card." },
          { id: 'd', label: 'Ask in the family group chat if anyone has seen it', ok: false, fb: "Asking around doesn't stop anyone from using it. Report it, then look for it." },
        ],
      },
      {
        seat: 'front',
        prompt: 'Someone at Longs taps card ••4417 for $49.99. What do you do?',
        info: ['Amount: $49.99', 'Card ending: ••4417'],
        options: [
          { id: 'a', label: 'Send an approval request to the card network', ok: true, fb: 'Correct, same as always.' },
          { id: 'b', label: 'Approve it — the card looks fine', ok: false, fb: "A store can't tell if a card was reported lost. That information isn't at the register." },
          { id: 'c', label: 'Run it as credit instead so it goes through faster', ok: false, fb: 'Same card, same check. Nothing skips the network.' },
        ],
      },
      {
        seat: 'network',
        prompt: 'An approval request arrived. Check the card.',
        info: ['Amount: $49.99', 'Card ••4417 status: REPORTED LOST 🚫', 'Reported: yesterday, 9:14 PM'],
        options: [
          { id: 'a', label: 'Decline — card was reported lost', ok: true, end: 'declined', fb: 'Stopped. The lost-card check happens before anyone even looks at the balance.' },
          { id: 'b', label: 'Route to the core anyway', ok: false, fb: "Why bother the core? This card shouldn't be used at all. Stopping it here protects the member." },
          { id: 'c', label: 'Approve it, but flag it so MCFCU can follow up', ok: false, fb: 'A flag after the fact means the money is already gone. A lost card gets stopped now.' },
          { id: 'd', label: 'Approve it', ok: false, fb: "Someone is using a lost card. That's the member's money walking out the door." },
        ],
      },
    ],
    outcome: {
      result: 'declined',
      headline: 'DECLINED at the card network',
      lesson: 'Not at the store, and not at the credit union. Where a "no" happens depends on what\'s wrong.',
    },
  },
  {
    id: 't3',
    title: 'Sneakers online',
    amount: '$85.00',
    teaser: 'Payday is Friday. Today is Wednesday.',
    labels: { member: 'Member', front: 'Online checkout', network: 'Card network & processor', core: 'MCFCU core system' },
    steps: [
      {
        seat: 'member',
        prompt: 'You find sneakers online for $85.00.',
        info: ['Pay with: debit card ••2290'],
        options: [
          { id: 'a', label: "Type the store's address yourself and check out there", ok: true, fb: 'Checked out on the real site. Good.' },
          { id: 'b', label: 'Click the "50% off" link someone DMed you', ok: false, fb: 'Deals that show up in your DMs are a top scam. Shop on sites you go to yourself.' },
          { id: 'c', label: 'Save your card number in your phone notes for next time', ok: false, fb: "Notes apps aren't locked up like a wallet. Anyone who gets into your phone gets the card." },
        ],
      },
      {
        seat: 'front',
        prompt: 'An order was submitted for $85.00.',
        info: ['Card ending: ••2290'],
        options: [
          { id: 'a', label: 'Send an approval request to the card network', ok: true, fb: 'Online or in person, it’s the same path.' },
          { id: 'b', label: 'Ship the shoes now and charge later', ok: false, fb: 'The store would be gambling that the money exists. It asks first.' },
          { id: 'c', label: "Hold the order until the customer's payday", ok: false, fb: "The store has no idea when anyone gets paid. It just asks, right now." },
        ],
      },
      {
        seat: 'network',
        prompt: 'An approval request arrived.',
        info: ['Amount: $85.00', 'Card ••2290 status: ACTIVE ✅', 'Card belongs to: Maui County FCU'],
        options: [
          { id: 'a', label: "Route it to MCFCU's core system", ok: true, fb: 'Routed.' },
          { id: 'b', label: 'Approve it yourself', ok: false, fb: 'The network still doesn’t know the balance.' },
          { id: 'c', label: 'Decline — online purchases are riskier', ok: false, fb: "The card is active. Online isn't automatically fraud. The network's job is to route it." },
        ],
      },
      {
        seat: 'core',
        prompt: 'Approval request for $85.00. Check the account.',
        info: ['Member: Noelani K.', 'Available balance: $41.20', 'Holds: none'],
        task: 'Checked balance for transaction #3',
        options: [
          { id: 'a', label: 'Decline — not enough money', ok: true, end: 'declined', fb: 'Declined. The account only has $41.20.' },
          { id: 'b', label: "Approve — they'll get paid Friday", ok: false, fb: "The system can't approve money that isn't there yet." },
          { id: 'c', label: 'Approve $41.20 now and the rest on Friday', ok: false, fb: "A card purchase is yes or no for the whole amount. The core can't split someone's sneakers." },
        ],
      },
    ],
    outcome: {
      result: 'declined',
      headline: 'DECLINED at the credit union',
      lesson: 'Same "declined" screen at checkout, but a totally different reason than the lost card. Only the core knows the balance.',
    },
  },
  {
    id: 't4',
    title: 'Cash withdrawal at the teller window',
    amount: '$60.00',
    teaser: 'Now the "front door" is a person: you.',
    labels: { member: 'Member', front: 'Teller workstation', network: 'Branch connection to core', core: 'MCFCU core system' },
    steps: [
      {
        seat: 'member',
        prompt: 'You walk up to the window and want $60 from savings.',
        info: ['You know the teller from class.'],
        options: [
          { id: 'a', label: 'Hand over your ID', ok: true, fb: 'Every time, even when the teller knows you.' },
          { id: 'b', label: '"You know me, no ID needed, right?"', ok: false, fb: '"I know you from class" is not ID. The teller has to verify every time.' },
          { id: 'c', label: 'Give your account number instead of ID', ok: false, fb: "An account number isn't proof of who you are. Anyone could have written it down." },
        ],
      },
      {
        seat: 'front',
        prompt: 'The member hands you a Hawaiʻi ID. Photo and name match the account.',
        info: ['Request: $60.00 cash from savings', 'You are logged in as: YOU'],
        options: [
          { id: 'a', label: 'Enter the withdrawal in the system and wait for approval', ok: true, fb: 'Right. Cash goes out after the system says yes, not before.' },
          { id: 'b', label: 'Hand over the cash now, enter it later', ok: false, fb: "If the system says no, or you forget, your drawer won't balance and nobody can prove what happened." },
          { id: 'c', label: 'Use the next teller’s login — yours is running slow', ok: false, fb: 'Everything you do would be recorded as them. Your login, your transactions, always.' },
        ],
      },
      {
        seat: 'network',
        prompt: 'The teller workstation wants to talk to the core.',
        info: ['Branch connection to core: UP ✅', 'Encrypted tunnel: OK'],
        options: [
          { id: 'a', label: 'Send it through the secure branch connection', ok: true, fb: 'Encrypted from the branch all the way to the core.' },
          { id: 'b', label: 'Send it over the free public Wi-Fi, it’s faster', ok: false, fb: 'Member data never travels over public Wi-Fi. The secure connection exists for a reason.' },
          { id: 'c', label: 'Email the request to the core team', ok: false, fb: "Email isn't how transactions travel, and it's not built to carry member data safely." },
        ],
      },
      {
        seat: 'core',
        prompt: 'Withdrawal request for $60.00.',
        info: ['Member: Makana P.', 'Savings balance: $512.00', 'Request made by: teller login "YOU"'],
        task: 'Checked balance for transaction #4',
        options: [
          { id: 'a', label: 'Approve and record the teller login', ok: true, fb: 'Approved, and the core recorded which teller login did it.' },
          { id: 'b', label: 'Decline', ok: false, fb: 'They have plenty in savings.' },
          { id: 'c', label: 'Approve, skip recording the teller to save time', ok: false, fb: 'Every transaction is tied to a login. That record protects the teller as much as the member.' },
        ],
      },
    ],
    outcome: {
      result: 'approved',
      headline: 'APPROVED and logged',
      lesson: "That transaction now has the teller's login attached to it forever. Remember that.",
    },
  },
  {
    id: 't5',
    title: 'Same window, ten minutes later',
    amount: '$60.00',
    teaser: 'Everything was fine a minute ago…',
    cut: 'network',
    labels: { member: 'Member', front: 'Teller workstation', network: 'Branch connection to core', core: 'MCFCU core system' },
    steps: [
      {
        seat: 'member',
        prompt: "It's your turn at the window. You want $60 from checking.",
        info: [],
        options: [
          { id: 'a', label: 'Hand over your ID', ok: true, fb: 'Verified.' },
          { id: 'b', label: '"I was just here, you don’t need my ID again"', ok: false, fb: 'Every transaction, every time.' },
          { id: 'c', label: 'Text the teller a photo of your ID', ok: false, fb: "Tellers don't use personal phones for member business, and a photo isn't the real ID." },
        ],
      },
      {
        seat: 'front',
        prompt: 'ID checks out. Enter the withdrawal.',
        info: ['Request: $60.00 cash from checking'],
        options: [
          { id: 'a', label: 'Enter the withdrawal in the system', ok: true, fb: 'Sent… waiting…' },
          { id: 'b', label: 'Hand over the cash first', ok: false, fb: 'Nope. Approval first.' },
          { id: 'c', label: "Add it to the last member's transaction to save time", ok: false, fb: 'Every transaction gets its own record, tied to the right member.' },
        ],
      },
      {
        seat: 'network',
        prompt: 'The teller workstation wants to talk to the core.',
        info: ['Branch connection to core: DOWN ❌', 'No response for 45 seconds'],
        options: [
          { id: 'a', label: "Report it: the request can't reach the core", ok: true, fb: "Honest answer: the road is out. Nothing is getting through." },
          { id: 'b', label: 'Keep retrying every second', ok: false, fb: "Hammering a dead connection doesn't fix it, and it can make the problem harder to diagnose." },
          { id: 'c', label: "Connect through the teller's personal phone hotspot", ok: false, fb: 'Never connect member systems to a personal device. It skips every security control we have.' },
          { id: 'd', label: "Resend it under a different teller's login", ok: false, fb: "The login isn't the problem; the road is. And you'd be acting as someone else." },
        ],
      },
      {
        seat: 'front',
        prompt: 'Your screen says: "Unable to reach host." The member is waiting.',
        info: ['Error: Unable to reach host', 'Member is waiting at your window'],
        options: [
          { id: 'a', label: 'Politely explain there’s a system issue and tell your supervisor', ok: true, end: 'paused', fb: 'Calm, honest, escalated. That’s the job.' },
          { id: 'b', label: 'Give the cash and write it on a sticky note for later', ok: false, fb: 'No approval, no record, no proof. Your drawer will be $60 short and nobody can prove why.' },
          { id: 'c', label: 'Restart your computer a few times', ok: false, fb: "Is it just you? The connection is down for the whole branch. Restarting won't fix that, and it wastes time." },
          { id: 'd', label: 'Tell the member the system got hacked', ok: false, fb: 'You don’t know that, and it scares people. "We’re having a system issue" is honest and calm.' },
        ],
      },
    ],
    outcome: {
      result: 'paused',
      headline: 'PAUSED: the branch connection was down',
      lesson: 'Nothing was wrong with the teller’s computer. The road to the core was out. That’s why "Is it just me?" is a troubleshooting step.',
    },
  },
];

// ─────────────────────────────────────────────────────────────
// MODULE 2 — HELP DESK (branching scenarios)
// Everyone votes. After reveal, the room's most popular choice decides what happens next.
// pts: 100 best, partial credit for reasonable-but-not-best.
// step: which troubleshooting step the option represents (shown at reveal).
// ─────────────────────────────────────────────────────────────
export const METHOD = ['Notice', 'Check the obvious', 'Is it just me?', 'Note it', 'Tell it'];

export const SCENARIOS = [
  {
    id: 's1',
    title: 'Blank receipts',
    icon: '🧾',
    start: 'n1',
    nodes: {
      n1: {
        text: "Your receipt printer is printing… blank paper. A member is waiting for their receipt.",
        options: [
          { id: 'a', label: 'Check the paper: is the roll in the right way?', pts: 100, step: 'Check the obvious', next: 'n1fix', fb: "Thermal receipt paper only prints on one side. Flip it and you're done in 10 seconds." },
          { id: 'b', label: 'Restart the computer', pts: 25, next: 'n1slow', fb: "The printer isn't the computer. A restart takes minutes while the line grows." },
          { id: 'c', label: 'Call IT right away', pts: 50, step: 'Tell it', next: 'n1fix', fb: "Not wrong, but checking the obvious first might save everyone the call." },
          { id: 'd', label: 'Hand-write a receipt from memory', pts: 0, next: 'n1fix', fb: 'Handwritten receipts with member info are a privacy and accuracy problem. Fix the printer.' },
        ],
      },
      n1slow: {
        text: 'The computer takes 4 minutes to restart. The line is now 5 people deep. The printer is still printing blank.',
        options: [
          { id: 'a', label: 'Check the paper roll', pts: 100, step: 'Check the obvious', next: 'n1fix', fb: 'There it is: the roll was in backwards.' },
          { id: 'b', label: 'Restart again', pts: 0, next: 'n1fix', fb: 'Same result, 4 more minutes. Your supervisor walks over and flips the paper roll.' },
          { id: 'c', label: 'Send members to the teller at the next window', pts: 25, next: 'n1fix', fb: 'Keeps the line moving, but your printer is still broken and the fix takes 10 seconds.' },
        ],
      },
      n1fix: {
        text: "Mystery solved: the paper roll was in backwards. It's fixed. Anything else?",
        options: [
          { id: 'a', label: 'Tell your supervisor/teammates so the next person knows the trick', pts: 100, step: 'Tell it', end: true, fb: "Sharing what you found means nobody else loses 10 minutes to it." },
          { id: 'b', label: "Nothing, it's fixed", pts: 50, end: true, fb: 'Fine, but a 10-second heads-up helps the next person.' },
          { id: 'c', label: 'Order a new printer so it never happens again', pts: 0, end: true, fb: 'Nothing was broken. Buying hardware is never a teller call, and the trick costs $0.' },
        ],
      },
    },
  },
  {
    id: 's2',
    title: 'Locked out',
    icon: '🔒',
    start: 'n1',
    nodes: {
      n1: {
        text: 'You type your password and see: "Your account has been locked."',
        options: [
          { id: 'a', label: 'Keep trying different passwords', pts: 0, next: 'nworse', fb: 'Every failed attempt is logged, and lots of failures can look like an attack.' },
          { id: 'b', label: 'Ask a coworker to log you in with their account', pts: 0, next: 'nborrow', fb: 'Never use someone else’s login, even to help. Everything you do will look like they did it.' },
          { id: 'c', label: 'Stop. Tell your supervisor and contact IT', pts: 100, step: 'Tell it', next: 'ngood', fb: 'Exactly. Locked means stop.' },
          { id: 'd', label: 'Write your password on a sticky note so it never happens again', pts: 0, next: 'ngood', fb: 'A password on a sticky note is a password anyone at your desk can use.' },
        ],
      },
      nborrow: {
        text: 'Malia logs you in under her account. You process 6 transactions. One is off by $200. The audit log says Malia did all six.',
        options: [
          { id: 'a', label: 'Tell your supervisor right now', pts: 100, step: 'Tell it', next: 'ngood', fb: 'Painful, but the only way to fix the record and protect Malia.' },
          { id: 'b', label: "Say nothing, it'll probably sort itself out", pts: 0, next: 'ngood', fb: "It won't. Malia now owns a $200 mistake she didn't make." },
          { id: 'c', label: "Quietly fix the $200 yourself under Malia's login", pts: 0, next: 'ngood', fb: 'That is one more change made as Malia. Now the record is wrong twice.' },
        ],
      },
      nworse: {
        text: 'IT gets an alert: 15 failed logins on your account in 3 minutes. They have to treat it as a possible attack until they know otherwise.',
        options: [
          { id: 'a', label: 'Tell your supervisor and IT what happened', pts: 100, step: 'Tell it', next: 'ngood', fb: 'Good. Now IT knows it was you, not an attacker.' },
          { id: 'b', label: 'Try a few more times quietly', pts: 0, next: 'ngood', fb: 'More failed logins, more alarm. Your supervisor comes to find you.' },
          { id: 'c', label: 'Wait 30 minutes for the lock to clear, then try again', pts: 25, next: 'ngood', fb: 'The lock might clear, but IT is still treating this as an attack until someone tells them.' },
        ],
      },
      ngood: {
        text: "IT calls you back. Before unlocking your account, they verify it's really you. Why?",
        options: [
          { id: 'a', label: 'Because anyone can call IT pretending to be you', pts: 100, end: true, fb: "Right. \"I'm locked out, please reset my password\" is one of the oldest tricks there is." },
          { id: 'b', label: "IT doesn't trust employees", pts: 0, end: true, fb: "It's not about you. IT can't see you over the phone, so they verify everyone." },
          { id: 'c', label: "It's just a rule, no real reason", pts: 0, end: true, fb: 'There’s a very real reason: attackers call help desks pretending to be employees.' },
        ],
      },
    },
  },
  {
    id: 's3',
    title: 'Is it just me?',
    icon: '🖥️',
    start: 'n1',
    nodes: {
      n1: {
        text: "The member system won't open on your computer, but regular websites load fine.",
        options: [
          { id: 'a', label: 'Ask the teller next to you if theirs works', pts: 100, step: 'Is it just me?', next: 'nall', fb: 'One question tells IT whether it’s your computer or the whole branch.' },
          { id: 'b', label: 'Unplug and replug the network cable', pts: 50, step: 'Check the obvious', next: 'nall', fb: "Good instinct, but websites load, so your cable is fine." },
          { id: 'c', label: 'Download a different web browser to try', pts: 0, next: 'nall', fb: "Installing software at work is never your call, and it wouldn't help anyway." },
        ],
      },
      nall: {
        text: "It's not just you. Every teller in the branch is down.",
        options: [
          { id: 'a', label: 'Write down the time and the exact error, then tell your supervisor', pts: 100, step: 'Note it', end: true, fb: 'Facts plus the right person. IT can work with that.' },
          { id: 'b', label: 'Take a phone photo of the error screen to send IT', pts: 25, end: true, fb: "Capturing the error is smart, but phone photos of work screens can capture member info. Write it down instead." },
          { id: 'c', label: 'Tell the members in line "we got hacked"', pts: 0, end: true, fb: 'You don’t know that. Try: "We’re having a system issue. Sorry for the wait."' },
          { id: 'd', label: 'Post about it in the group chat', pts: 0, end: true, fb: 'What happens at work stays at work. Your supervisor and IT are the right people.' },
        ],
      },
    },
  },
  {
    id: 's4',
    title: 'VIRUS DETECTED!',
    icon: '⚠️',
    start: 'n1',
    nodes: {
      n1: {
        text: 'A loud pop-up takes over your screen: "VIRUS DETECTED! Call Microsoft Support at 1-888-555-0199 NOW or lose your files!"',
        options: [
          { id: 'a', label: 'Call the number on the screen', pts: 0, next: 'ncall', fb: 'Real companies never put a phone number in a scary pop-up. That number goes to a scammer.' },
          { id: 'b', label: 'Close the pop-up and keep working', pts: 25, next: 'nend', fb: "Better than calling, but IT needs to know. Something put that pop-up there." },
          { id: 'c', label: "Don't click anything. Tell your supervisor/IT", pts: 100, step: 'Tell it', next: 'nend', fb: "Perfect. Hands off, report it." },
        ],
      },
      ncall: {
        text: '"Hi, this is Microsoft. I need you to install a remote access app so I can clean your computer. It\'s urgent."',
        options: [
          { id: 'a', label: "Install it, it's Microsoft", pts: 0, next: 'nend', fb: 'Remote access gives the caller full control of your computer, and everything your login can reach.' },
          { id: 'b', label: 'Hang up and tell IT immediately', pts: 100, step: 'Tell it', next: 'nend', fb: "Hanging up is always allowed. Then report it." },
          { id: 'c', label: 'Ask for their employee ID number first', pts: 25, next: 'nend', fb: 'A scammer will happily make one up. Hang up and call IT on a number you already know.' },
        ],
      },
      nend: {
        text: 'This is the same tech-support scam aimed at kupuna, now aimed at YOU, because your login can reach member accounts. What’s the rule?',
        options: [
          { id: 'a', label: 'Never let anyone "remote in" unless IT set it up', pts: 100, end: true, fb: 'Exactly. The real IT team doesn’t need a pop-up to find you.' },
          { id: 'b', label: 'Only let them in if they sound professional', pts: 0, end: true, fb: 'Scammers are VERY professional. Sounding legit is their job.' },
          { id: 'c', label: 'Only if they know your name and where you work', pts: 0, end: true, fb: "That's on your nametag and social media. Knowing it proves nothing." },
        ],
      },
    },
  },
  {
    id: 's5',
    title: 'The technician',
    icon: '🧰',
    start: 'n1',
    nodes: {
      n1: {
        text: 'A guy in a polo shirt with a logo walks in carrying a toolbox: "Here to service the ATM. I need into the back office."',
        options: [
          { id: 'a', label: 'Let him in, he looks legit', pts: 0, next: 'nin', fb: 'A shirt and a toolbox cost $30. Looking the part is the whole trick.' },
          { id: 'b', label: 'Ask him to wait while you check with your supervisor', pts: 100, step: 'Tell it', next: 'ncheck', fb: 'Verify the visit, not the outfit.' },
          { id: 'c', label: 'Check his ID badge, then let him in', pts: 25, next: 'ncheck', fb: 'Badges can be faked in minutes. The question is: was this visit scheduled?' },
        ],
      },
      nin: {
        text: 'He leaves 20 minutes later. That afternoon, someone notices a small device plugged in behind a computer.',
        options: [
          { id: 'a', label: "Don't touch it. Tell your supervisor immediately", pts: 100, step: 'Tell it', end: true, fb: 'Leave it for IT and security. It’s evidence now.' },
          { id: 'b', label: 'Unplug it and throw it away', pts: 25, end: true, fb: 'Well-meant, but that destroys evidence. Report it first.' },
          { id: 'c', label: 'Plug it into your own computer to see what it is', pts: 0, end: true, fb: 'Never plug in an unknown device. That may be exactly what it was built for.' },
        ],
      },
      ncheck: {
        text: 'Your supervisor calls the ATM company using the number on file. No visit was scheduled today.',
        options: [
          { id: 'a', label: 'Stay calm and let your supervisor handle it', pts: 100, end: true, fb: "Your job was to pause and ask. You did it, and it worked." },
          { id: 'b', label: 'Confront him yourself', pts: 0, end: true, fb: "Never put yourself in danger. Your supervisor and the authorities handle it from here." },
          { id: 'c', label: 'Keep him chatting so he doesn’t leave', pts: 25, end: true, fb: 'Stay polite and keep your distance, but don’t play detective. That’s your supervisor’s call.' },
        ],
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────
// MODULE 3 — THE INBOX (a teller's email)
// verdict: 'phish' | 'legit'. link.url is where the link really goes.
// ─────────────────────────────────────────────────────────────
export const EMAILS = [
  {
    id: 'e1',
    fromName: 'IT Help Desk',
    fromAddr: 'it-helpdesk@mauicounty-fcu.com',
    subject: 'Your password expires in 2 hours',
    time: '8:02 AM',
    body: [
      'Your network password will expire in 2 hours.',
      'To keep your current password and avoid being locked out, confirm it below.',
    ],
    link: { text: 'Keep My Password', url: 'https://mauicounty-fcu.com/password-keep' },
    verdict: 'phish',
    clues: [
      'Look closely: mauicounty-fcu.com has an extra dash. The real domain is mauicountyfcu.org.',
      'Urgency: "2 hours" is meant to rush you.',
      'IT will never email you a link to "keep" or type your password.',
    ],
  },
  {
    id: 'e2',
    fromName: 'Henry Arroyo',
    fromAddr: 'harroyo@mauicountyfcu.org',
    subject: "Today's training: bring your phone",
    time: '9:15 AM',
    body: [
      "Aloha! For today's session at the branch, please bring your phone. We'll use it for a couple of games.",
      'See you there.',
    ],
    link: null,
    verdict: 'legit',
    clues: [
      'Real domain (mauicountyfcu.org), from someone you expected to hear from.',
      'It asks for nothing: no link, no login, no money, no secrets.',
    ],
  },
  {
    id: 'e9',
    fromName: 'IT Help Desk',
    fromAddr: 'helpdesk@mauicountyfcu.org',
    subject: 'Reminder: your password expires in 5 days',
    time: '9:48 AM',
    body: [
      'Your network password expires in 5 days.',
      'To change it, press Ctrl+Alt+Delete on your work computer and choose "Change a password." If you get stuck, call the Help Desk number in the staff directory.',
      'Never reply to any email with your password.',
    ],
    link: null,
    verdict: 'legit',
    clues: [
      'Real domain (mauicountyfcu.org), and it sends you to the normal process on your own computer, not to a link.',
      'Compare it to the 8:02 email: same topic, but this one never asks you to type your password anywhere.',
      'It points you to a phone number you already have, not one inside the email.',
    ],
  },
  {
    id: 'e3',
    fromName: 'Michele (CEO)',
    fromAddr: 'michele.mcfcu.ceo@gmail.com',
    subject: 'Quick favor, are you at your desk?',
    time: '10:41 AM',
    body: [
      'I need you to pick up 4 Apple gift cards ($100 each) for a member appreciation event. I’ll pay you back today.',
      'Please keep this between us, it’s a surprise. Text me the codes when you have them.',
    ],
    link: null,
    verdict: 'phish',
    clues: [
      "A Gmail address, not the credit union's. Anyone can name a Gmail account \"CEO.\"",
      'Gift cards + secrecy + urgency = PAUSE. That’s three red flags.',
      'Verify by calling a known number or walking over and asking. Never reply to the email.',
    ],
  },
  {
    id: 'e4',
    fromName: 'MCFCU Marketing',
    fromAddr: 'marketing@mauicountyfcu.org',
    subject: 'Cybersecurity Awareness Month: 5 easy habits',
    time: '11:30 AM',
    body: [
      "It's Cybersecurity Awareness Month! We posted five easy habits to keep accounts safe on our blog.",
      'Feel free to share it with members who ask.',
    ],
    link: {
      text: 'Read the tips',
      url: 'https://www.mauicountyfcu.org/resources/learn/blog/october-2026/outsmart-cybercriminals/',
    },
    verdict: 'legit',
    clues: [
      'Sender and link both go to the real domain: mauicountyfcu.org.',
      "It doesn't ask you to log in or give anything. It just points to a public article.",
    ],
  },
  {
    id: 'e5',
    fromName: 'Microsoft 365',
    fromAddr: 'no-reply@m1crosoft-security.com',
    subject: 'Unusual sign-in activity detected',
    time: '12:07 PM',
    body: [
      'We detected a sign-in to your account from a new device in Lagos, Nigeria.',
      'If this wasn’t you, secure your account immediately.',
    ],
    link: { text: 'Secure My Account', url: 'https://login.microsoftonline.com.account-verify.io/secure' },
    verdict: 'phish',
    clues: [
      '"m1crosoft" uses the number 1 instead of the letter i.',
      'Read the link from the END: the real site is account-verify.io, not microsoftonline.com.',
      'Fear ("someone is in your account!") is the hook.',
    ],
  },
  {
    id: 'e6',
    fromName: 'Venmo',
    fromAddr: 'payments@venmo-payment-support.com',
    subject: 'You received $250.00. Confirm to accept',
    time: '1:22 PM',
    body: [
      "You've received $250.00! To deposit the money, confirm your account within 24 hours or the payment will be returned.",
    ],
    link: { text: 'Confirm & Accept', url: 'https://venmo-payment-support.com/claim?id=88213' },
    verdict: 'phish',
    clues: [
      'Not venmo.com. Real Venmo payments land in your app; you never "confirm to accept."',
      'Free money + a deadline = the bait.',
    ],
  },
  {
    id: 'e10',
    fromName: 'SOCU Program',
    fromAddr: 'socu@mauicountyfcu.co',
    subject: 'Confirm your volunteer hours by Friday',
    time: '2:15 PM',
    body: [
      "We're switching to a new system for tracking SOCU volunteer hours. Sign in with your work email and password by Friday to confirm your hours, or they won't count toward your service requirement.",
      'Mahalo, SOCU Program',
    ],
    link: { text: 'Confirm My Hours', url: 'https://mauicountyfcu.co/socu/hours' },
    verdict: 'phish',
    clues: [
      'Look at the very end of the address: .co, not .org. One missing letter is the whole trick.',
      'A "new system" you hear about only through an email link? Your supervisor would tell you in person.',
      'A deadline on something you care about (your hours) is how they rush you past the checking step.',
    ],
  },
  {
    id: 'e7',
    fromName: 'Facilities Team',
    fromAddr: 'facilities@mauicountyfcu.org',
    subject: 'Heads up: parking lot repaving Friday',
    time: '2:48 PM',
    body: [
      'The back parking lot will be closed Friday for repaving. Please use the street parking on the side of the building.',
      'Mahalo for your patience!',
    ],
    link: null,
    verdict: 'legit',
    clues: [
      'Real domain, ordinary information, and nothing to click, sign in to, or pay.',
      'Not every email is a trap. The skill is checking, not panicking.',
    ],
  },
  {
    id: 'e8',
    fromName: 'DocuSign',
    fromAddr: 'dse@docusign-notify.co',
    subject: 'Your SOCU certificate is ready to sign',
    time: '3:10 PM',
    body: [
      'Maui County FCU sent you a document to review and sign: "SOCU Volunteer Certificate.pdf".',
      'Sign in with your work email and password to view.',
    ],
    link: { text: 'Review Document', url: 'https://docusign.secure-view.co/sign/88213' },
    verdict: 'phish',
    clues: [
      'Not docusign.com or docusign.net. secure-view.co is the real destination.',
      'Asks for your work email AND password just to "view" a document.',
      'Uses something you might actually expect (a certificate) to lower your guard.',
    ],
  },
];

// ─────────────────────────────────────────────────────────────
// HONEYPOT — "Member Lookup"
// Fictional, deliberately generic. Every open and every record view is logged.
// ─────────────────────────────────────────────────────────────
export const LOOKUP_MEMBERS = [
  { id: 'm1', name: 'Coach K.', tag: 'Football coach', accounts: [['Checking', '$3,214.55'], ['Savings', '$12,880.10']], recent: ['Payroll deposit +$1,840.00', 'Costco −$212.43', 'Venmo −$40.00'] },
  { id: 'm2', name: 'Mr. T.', tag: 'Math teacher', accounts: [['Checking', '$918.02'], ['Auto loan', '−$14,220.00']], recent: ['Payroll deposit +$2,105.11', 'Times Supermarket −$87.19'] },
  { id: 'm3', name: 'Kai M.', tag: 'Class of 2027', accounts: [['Savings', '$86.12']], recent: ['Cash withdrawal −$20.00', 'Roblox −$9.99'] },
  { id: 'm4', name: 'Auntie L.', tag: 'Kupuna', accounts: [['Savings', '$41,233.00'], ['Certificate', '$25,000.00']], recent: ['Social Security +$1,512.00'] },
  { id: 'm5', name: 'The Snack Shack', tag: 'Local business', accounts: [['Business checking', '$6,702.40']], recent: ['Deposit +$1,120.00', 'Supplier −$640.00'] },
];
