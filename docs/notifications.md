# Notifications

When the task in the session you are watching finishes, PI WEB posts a notice to the device's
notification centre: which session finished, how long its task took, and a tap that opens the answer.
The time is the span this device watched, from the task's first working frame to its finish - the same
number the bottom line shows afterwards - and a notice whose task this page joined partway says the task
ended without claiming a time.

Turn it on in **Settings → Notifications**. The switch asks the browser for permission the first time,
and the preference is stored on that device only: turning it on for your phone does not turn it on for
your laptop.

## What the switch reports

The panel separates two answers that are easy to confuse:

- **What the browser allows.** A permission you denied in Safari's site settings stays denied until you
  unblock it there; the page cannot ask its way past it. The panel says so rather than showing a switch
  that appears to be on.
- **What you asked for.** The switch. It is off until you turn it on, on each device.

Notifications need an HTTPS address. A plain `http://` page is refused by the browser, and the panel
says that instead of failing quietly. On iPhone and iPad, Safari shows web notifications only to the
installed web app, so [add PI WEB to the Home Screen](install.md#install-on-iphone-or-ipad) and turn
the switch on there.

**Send a test notice** posts one now, so you can see where the notification centre puts it before you
rely on it for a long task.

## When a notice arrives, and when it does not

The page posts the notice, so it arrives while that browser is running - including when PI WEB is in a
background tab, which is the common case: start a task, switch to another tab, get told when it ends.

- A task you stopped yourself with **Stop** does not notify you; the notice would only report your own
  action.
- A task that finishes while you are looking at the page does not notify you.
- A notice does not arrive after the browser has been quit. A notification that reaches a closed browser
  has to be sent by the server through Apple's push service, with a VAPID key pair and a stored
  subscription per device; PI WEB does not do that yet.

Each session keeps one notice at a time: a second finished task replaces the first, so a phone's lock
screen does not fill with a list of turns you have already read.

## Reading aids on the same page

The page also answers reading questions in place: **double-click a word** for a small toolbar (copy it,
search for it, translate it), and **press and hold a sentence** to see its translation written under the
sentence. Translation is answered by the server; see
[translation configuration](config.md#translation) for the provider, the target language, and how to
turn it off.
