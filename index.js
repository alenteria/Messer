#!/usr/bin/env node
"use strict"

/* Imports */
const repl = require("repl")
const facebook = require("facebook-chat-api")
const exec = require('child_process').exec;

/* Globals */
let api = {}
let user = {}
let lastThread = null
let lastRecipient = null

/* Command type constants */
const commandEnum = {
	MESSAGE: "message",
	REPLY: "reply",
	CONTACTS: "contacts",
	HELP: "help"
}

const commandMap = {
	"r": commandEnum.REPLY,
	"m": commandEnum.MESSAGE
}

/* Initialisation */
if (process.argv.length < 3) {
	//	User didn't store credentials in JSON, make them manually enter credentials
	const prompt = require("prompt")
	console.log("Enter your Facebook credentials - your password will not be visible as you type it in")
	prompt.start()

	prompt.get([{
		name: "email",
		required: true
	}, {
		name: "password",
		hidden: true,
		conform() { return true }
	}], (err, result) => { authenticate(result) })

} else {
	const fs = require("fs")
	fs.readFile(process.argv[2], (err, data) => {
		if (err) return console.log(err)

		authenticate(JSON.parse(data))
	})
}

/**
 * Fetches and stores all relevant user details using a promise.
 */
function getUserDetails() {
	console.info("Fetching user details...")
	return new Promise((resolve, reject) => {
		api.getFriendsList((err, data) => {
			if (err) {
				console.error(err)
				reject()
			}
			user.friendsList = data
			resolve()
		})
	})
}

/**
 * Handles incoming messages by logging appropriately.
 */
function handleMessage(message) {
	const unrenderableMessage = "https://www.messenger.com/m/"+message.messageID

	// seen message (not sent)
	if (!message.senderID || message.type != "message")
		return

	let sender = user.friendsList.find(f => { return f.userID === message.senderID })
	if (!!!sender){
		return false;
	}

	sender = sender.fullName || "Unknown User"

	if (message.participantNames && message.participantNames.length > 1)
		sender = "'" + sender + "'" + " (" + message.senderName + ")"

	if (lastThread == message.threadID){
		process.stderr.write("\x07")	// Terminal notification
	}else{
		exec("say new message from "+sender);
	}

	let messageBody = null

	if (message.body !== undefined && message.body != "") {
		// console.log("New message sender " + sender + " - " + message.body)
		messageBody = message.body
	}

	if (lastRecipient != sender){
		console.log('')
		console.log("\x1b[5m", " ---------- ", "\x1b[0m", sender, "\x1b[5m", " ---------- ", "\x1b[0m")
	}

	if (message.attachments.length == 0) {
		console.log("")
		console.log("\x1b[46m", sender, "\x1b[0m", ": "+(messageBody || unrenderableMessage))
	} else {
		console.log("")
		console.log("\x1b[46m", sender, "\x1b[0m", ": "+(messageBody || unrenderableMessage))
	}

	lastThread = message.threadID
	lastRecipient = sender
}

/* command handlers */
const commands = {
  /**
   * Sends message to given user
   */
	message(rawCommand) {
		const quoteReg = /(".*?")(.*)/g
		// to get length of first arg
		const args = rawCommand.replace("\n", "").split(" ")
		let cmd = rawCommand.substring(args[0].length).trim()

		if (cmd.match(quoteReg) == null) {
			let possibleRecipient = ((cmd || "").split(" ")[0]);
			if (possibleRecipient.length > 0){
				cmd = cmd.replace(possibleRecipient, '"'+possibleRecipient+'"')
			}else{
				console.warn("Invalid message - check your syntax")
				return processCommand("help")
			}
		}

		const decomposed = quoteReg.exec(cmd)
		const rawReceiver = decomposed[1].replace(/"/g, "") || ""
		const message = decomposed[2].trim()

		if (message.length == 0) {
			return false
		}

		// Find the given reciever in the users friendlist
		const receiver = user.friendsList.find(f => {
			return f.fullName.toLowerCase().startsWith(rawReceiver.toLowerCase()) || ((f.vanity || "").toLowerCase() == rawReceiver.toLowerCase())
		})

		if (!receiver) {
			console.warn("User \"" + rawReceiver + "\"" + " could not be found in your friends list!")
			return
		}

		api.sendMessage(message, receiver.userID, (err, res) => {
			lastThread = res.threadID || res.messageID
			if (err) console.warn("ERROR!", err)
			if (receiver.fullName != lastRecipient){
				console.log('')
				console.log("\x1b[5m", " ---------- ", "\x1b[0m", receiver.fullName, "\x1b[5m", " ---------- ", "\x1b[0m")
			}

			console.log("\x1b[42m", "You", "\x1b[0m", ": "+message + "\n>")
			lastRecipient = receiver.fullName
		})
	},

  /**
   * Replies with a given message to the last received thread.
   */
	reply(rawCommand) {
		if (lastThread === null) {
			console.warn("Error - can't reply to messages you haven't yet received! You need to receive a message before using `reply`!")
		}

		const args = rawCommand.replace("\n", "").split(" ")
		const body = rawCommand.substring(args[0].length).trim()

		// var body = rawCommand.substring(commandEnum.REPLY.length).trim()
		api.sendMessage(body, lastThread, err => {
			if (err) return console.error(err)
			console.log("\x1b[42m", "You", "\x1b[0m", ": " + body);
		})
	},

  /**
   * Displays users friend list
   */
	contacts() {
		user.friendsList.forEach(f => { console.log(f.fullName) })
	},

  /**
   * Displays usage instructions
   */
	help() {
		console.log("Commands:\n" +
			"\tmessage \"[user]\" [message]\n" +
			"\tcontacts\n"
		)
	}
}

/**
 * Execute appropriate action for user input commands
 */
function processCommand(rawCommand) {
	const args = rawCommand.replace("\n", "").split(" ")
	const command = commandMap[args[0]] || args[0]
	const commandHandler = commands[command]

	if (!commandHandler) {
		if (lastThread != null){
			commands.reply("r "+rawCommand);
		}else{
			console.error("Invalid command - check your syntax\n>")
		}
	} else {
		commandHandler(rawCommand)
	}
}

function authenticate(credentials) {
	facebook(credentials, (err, fbApi) => {
		if (err) return console.error(err)

		api = fbApi // assign to global variable
		api.setOptions({ logLevel: "silent" })

		console.info("Logged in as " + credentials.email)

		getUserDetails(api, user).then(() => {
			console.info("Listening for incoming messages...")

			// listen for incoming messages
			api.listen((err, message) => {
				if (err) return console.error(err)
				handleMessage(message)
			})

			// start REPL
			repl.start({
				ignoreUndefined: true,
				eval(cmd) {
					processCommand(cmd)
				}
			})
		})

	})
}
