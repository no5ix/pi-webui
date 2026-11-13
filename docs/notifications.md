# Notifications
PI WEB tells you about three things: a task **finished**, a task **failed**, and a session that is
**asking you for an answer**. Two channels carry those notices, and you can turn each one on its own:

- **This browser** posts a notice to the device's notification centre. It works while the browser is
  running, including in a background tab.
- **ntfy** posts to a topic on an ntfy server, from the session daemon. It reaches a phone whose browser
  is closed, which is the reason to set it up.

Turn either on in **Settings → Notifications**, where the same panel shows three switches (finished,
failed, asking), the state of each channel, and a test button for each.

## This browser
The page posts the notice, through a service worker registration, because Safari shows no web
notification that is posted any other way. The time on a finished notice is the whole task: the session
daemon measures it from the prompt you sent to the last entry, so a phone that never opened the page
reads the same number as the line at the bottom of the window.

The panel separates two answers that are easy to confuse:

- **What the browser allows.** A permission you denied in Safari's site settings stays denied until you
  unblock it there; the page cannot ask its way past it. The panel says so rather than showing a switch
  that appears to be on.
- **What you asked for.** The switch. It is off until you turn it on, on each device.

Notifications need an HTTPS address. A plain `http://` page is refused by the browser, and the panel
says that instead of failing quietly. On iPhone and iPad, Safari shows web notifications only to the
installed web app, so [add PI WEB to the Home Screen](install.md#install-on-iphone-or-ipad) and turn
the switch on there.

A browser does not reliably show its own notification to the page you are looking at. PI WEB does not
pretend otherwise: when the notification centre takes nothing while the page is on screen, the same
words appear as a notice row in the window, so you are told either way. **Send a test notice** posts one
now, so you can see where the notification centre puts it.

Each session keeps one notice at a time: a second finished task replaces the first, so a phone's lock
screen does not fill with a list of turns you have already read.

## ntfy
ntfy is a plain HTTP publish: PI WEB posts a message to `https/<your-server>/<your-topic>`, and the ntfy
app on your phone shows it. No push keys, no subscription store, no daemon of its own.

Set it up in **Settings → Notifications**: the server (default `https://ntfy.sh`), the topic, and the
three switches. **Send a test notice** posts one, and reports what the server answered - so you learn
what the channel does before a task depends on it.

**Treat the topic as a password.** On the public server the topic is the whole address: anyone who can
name it can publish to it and read what arrives. Two things follow, and PI WEB does them for you:

- The topic is never sent to a browser. The settings panel shows `•••••• stored` and a test button; it
  never displays what is stored.
- The topic is cut out of log lines and out of failure messages.

A save that leaves the topic box empty keeps the stored topic, so turning a switch on cannot delete the
channel. To stop using a topic, remove it in the panel.

Because the session daemon posts the notice, ntfy works when no browser is open - a phone in your
pocket, a laptop with PI WEB closed. The notice names the session and the event, and tapping it opens
that session when PI WEB has been given its address for taps (`ntfy.clickUrlBase`,
see [configuration](config.md#notifications)).

A notice is sent once per event: a session that reports a finished run twice, or a dialog that redraws,
puts one notice on the phone.

## When a notice does not arrive
- A task you stopped yourself with **Stop** does not notify you; the notice would only report your own
  action.
- An event you did not switch on is not sent, on either channel.
- The browser's notice does not arrive after that browser has been quit - that is what ntfy is for. A
  notification that reaches a closed browser through Apple's own push service has to be sent by the
  server with a VAPID key pair and a stored subscription per device; PI WEB does not do that yet.
- A notice that fails is reported where you can see it: the settings panel shows the channel's last
  outcome, and the browser's test says what the notification centre did.

## Reading aids on the same page
The page also answers reading questions in place: **double-click a word** for a small toolbar (copy it,
search for it, translate it), and **press and hold a sentence** to see its translation written under the
sentence. Translation is answered by the server; see
[translation configuration](config.md#translation) for the provider, the target language, and how to
turn it off.
