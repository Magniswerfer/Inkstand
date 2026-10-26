// Word lists for the style check. English only. Each entry is a phrase; redundancies may carry
// a suggested replacement after "=>".

export const FILLERS = `
actually, absolutely, basically, certainly, clearly, completely, definitely, essentially, extremely,
fairly, frankly, generally, honestly, hopefully, incredibly, just, kind of, literally, mostly, obviously,
perhaps, practically, pretty much, quite, rather, really, relatively, seemingly, simply, slightly,
somehow, somewhat, sort of, surely, totally, truly, utterly, very, virtually, a bit, a little bit,
for all intents and purposes, in a sense, in my opinion, it goes without saying,
needless to say, so to speak, to be honest, as a matter of fact, by and large, more or less,
in terms of, the fact that, it seems that, i think that, i believe that, i feel that, of course,
anyway, anyhow, whatsoever, overall, arguably, particularly, especially, highly, deeply, awfully,
terribly, super, ultimately, typically, normally, usually, approximately, roughly
`

export const CLICHES = `
a blessing in disguise, a dime a dozen, a drop in the bucket, a game changer, a level playing field,
a perfect storm, a piece of cake, a walk in the park, ace up your sleeve, across the board,
add insult to injury, against all odds, all in a day's work, all walks of life, around the clock,
as luck would have it, at a loss for words, at the drop of a hat, at the end of the day,
avoid it like the plague, back to square one, back to the drawing board, barking up the wrong tree,
beat around the bush, bend over backwards, best of both worlds, better late than never,
between a rock and a hard place, beyond the pale, bite the bullet, bite off more than you can chew,
blood is thicker than water, bottom line, break the ice, burn the midnight oil, by the book,
calm before the storm, can't judge a book by its cover, chomping at the bit, cold feet,
come full circle, cool as a cucumber, crystal clear, cut to the chase, cutting edge, dead as a doornail,
deep dive, devil's advocate, don't count your chickens, down to earth, draw a line in the sand,
easier said than done, every cloud has a silver lining, few and far between, fit as a fiddle,
food for thought, from the ground up, game plan, get the ball rolling, go the extra mile,
going forward, hit the ground running, hit the nail on the head, in a nutshell, in the nick of time,
in the same boat, it is what it is, jump on the bandwagon, keep your eyes peeled, last but not least,
leave no stone unturned, let the cat out of the bag, light at the end of the tunnel, low-hanging fruit,
make a long story short, moment of truth, move the needle, needle in a haystack, new normal,
nip it in the bud, no brainer, not rocket science, off the beaten path, on the same page,
once in a blue moon, only time will tell, out of the box, outside the box, over the moon,
paradigm shift, pave the way, perfect storm, play it by ear, plenty of fish in the sea,
pull out all the stops, push the envelope, put all your eggs in one basket, raise the bar,
read between the lines, reinvent the wheel, run of the mill, scratch the surface, see eye to eye,
sharp as a tack, shift gears, sleep like a log, slippery slope, so far so good, state of the art,
steal the show, stick out like a sore thumb, take it with a grain of salt, take the bull by the horns,
the elephant in the room, the last straw, the tip of the iceberg, think outside the box,
throw in the towel, through thick and thin, time flies, time will tell, tip of the iceberg,
to the next level, touch base, under the weather, up in the air, viable alternative, when all is said and done,
win-win, without a doubt, worth its weight in gold, writing on the wall, you can't have your cake and eat it too
`

export const REDUNDANCIES = `
absolutely essential => essential, absolutely certain => certain, actual fact => fact, added bonus => bonus,
advance planning => planning, advance warning => warning, all-time record => record, alternative choice => choice,
and etc => etc, armed gunman => gunman, ascend up => ascend, ask a question => ask, assemble together => assemble,
ATM machine => ATM, attach together => attach, basic fundamentals => fundamentals, basic necessities => necessities,
blend together => blend, brief moment => moment, brief summary => summary, careful scrutiny => scrutiny,
cash money => cash, circle around => circle, classic tradition => tradition, close proximity => proximity,
collaborate together => collaborate, combine together => combine, completely destroyed => destroyed,
completely eliminate => eliminate, completely filled => filled, completely finished => finished,
consensus of opinion => consensus, continue on => continue, current trend => trend, descend down => descend,
difficult dilemma => dilemma, direct confrontation => confrontation, disappear from sight => disappear,
drop down => drop, due to the fact that => because, during the course of => during, each and every => each,
earlier in time => earlier, empty space => space, end result => result, enter in => enter,
equal to one another => equal, estimated at about => estimated at, evolve over time => evolve,
exact same => same, exactly the same => the same, false pretense => pretense, few in number => few,
filled to capacity => full, final conclusion => conclusion, final outcome => outcome, first and foremost => first,
follow after => follow, foreign imports => imports, free gift => gift, frozen ice => ice, full satisfaction => satisfaction,
future plans => plans, general consensus => consensus, general public => public, grow larger => grow,
HIV virus => HIV, hollow tube => tube, honest truth => truth, hot water heater => water heater,
in close proximity => near, in order to => to, in spite of the fact that => although, join together => join,
joint collaboration => collaboration, kneel down => kneel, LCD display => LCD, lift up => lift,
little baby => baby, live audience => audience, look back in retrospect => look back, major breakthrough => breakthrough,
mental telepathy => telepathy, merge together => merge, mix together => mix, mutual cooperation => cooperation,
natural instinct => instinct, never before => never, new innovation => innovation, new invention => invention,
new record => record, now pending => pending, old adage => adage, old cliche => cliche, open up => open,
oral conversation => conversation, outside of => outside, over exaggerate => exaggerate, overused cliche => cliche,
past experience => experience, past history => history, past memories => memories, penetrate into => penetrate,
period of time => period, personal opinion => opinion, PIN number => PIN, plan ahead => plan,
plan in advance => plan, postpone until later => postpone, pre-plan => plan, protest against => protest,
raise up => raise, reason is because => reason is, reason why => reason, recur again => recur,
regular routine => routine, repeat again => repeat, reply back => reply, return back => return,
revert back => revert, rise up => rise, safe haven => haven, same identical => identical, sand dune => dune,
scrutinize carefully => scrutinize, separate apart => separate, shuttle back and forth => shuttle,
since the time when => since, sink down => sink, small in size => small, sudden impulse => impulse,
sum total => total, surrounded on all sides => surrounded, temper tantrum => tantrum, true facts => facts,
twelve noon => noon, ultimate goal => goal, unexpected surprise => surprise, unintended mistake => mistake,
unique individual => individual, unless and until => until, usual custom => custom, very unique => unique,
visible to the eye => visible, warn in advance => warn, whether or not => whether, written down => written,
at this point in time => now, at the present time => now, in the event that => if, for the purpose of => for,
with the exception of => except, has the ability to => can, is able to => can, a large number of => many,
in the near future => soon, on a daily basis => daily, on a regular basis => regularly
`

export interface PhraseEntry {
  phrase: string
  suggestion?: string
}

export function parseList(src: string): PhraseEntry[] {
  return src
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [phrase, suggestion] = s.split('=>').map((x) => x.trim())
      return { phrase, suggestion }
    })
}
