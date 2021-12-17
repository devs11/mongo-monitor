import {MongoClient, Db, Long, Timestamp} from 'mongodb';
import {get} from 'https';
var nconf = require('nconf');
var os = require("os");
var path = require('path');

interface ConfigFile {
	"general": {
        "default_timeout": number,
		"timeout_limit": number,
        "enable_log": Boolean,
		"enable_err": Boolean,
        "enable_telegram_alert": Boolean,
    },
    "telegram": {
        "bot_name": string, 
        "bot_key": string,
        "chatid": string,
        "telegram_url": string,
		"telegram_prefix": string,
    },
    "mongodb": {
        "mongodb_host": string,
        "mongodb_port": string,
        "mongodb_database": string,
        "authentication": Boolean,
        "mongodb_username": string,
        "mongodb_password": string,
    }
}

class TelegramNotifyer {
	bot_enable: Boolean;
	bot: string;
	key: string;
	chatid: string;
	uri: string;
	prefix: string;


	constructor(configFile: ConfigFile) {
		this.bot_enable = configFile.general.enable_telegram_alert;
		this.bot = configFile.telegram.bot_name;
		this.key = configFile.telegram.bot_key;
		this.chatid = configFile.telegram.chatid;
		if (configFile.telegram.telegram_url.charAt(configFile.telegram.telegram_url.length -1) != "/") {
			this.uri = configFile.telegram.telegram_url + "/";
		} else {
			this.uri = configFile.telegram.telegram_url;
		}
		this.prefix = configFile.telegram.telegram_prefix;
	}

	send_msg(message: string) {
		if (this.bot_enable) {
			message = this.prefix + " " + message;
			let botUrl: string = this.uri + this.bot + ":" + this.key + "/sendMessage?chat_id=" + this.chatid + "&text=" + message;
			try {
				get(botUrl);
				Logger.log("Telegram Message dispatched!");
			} catch (e: any) {
				Logger.error("could not send telegram message!");
				Logger.error(e);
			}
		}
	}
}

interface MongoDBstats {
	db: String,
	collections: number,
	views: number,
	objects: number,
	avgObjSize: number,
	dataSize: number,
	storageSize: number,
	freeStorageSize: number,
	indexes: number,
	indexSize: number,
	indexFreeStorageSize: number,
	totalSize: number,
	totalFreeStorageSize: number,
	scaleFactor: number,
	fsUsedSize: number,
	fsTotalSize: number,
	ok: number
}

class MongoDBconnector {
	db_url: string;
	db_name: any;
	mdb?: Db;
	mclient: MongoClient;
	knownCollections: string[] = [];
	telegramAlert: TelegramNotifyer;

	
	constructor(configFile: ConfigFile, telegramAlert: TelegramNotifyer) {
		if (configFile.mongodb.authentication) {
			this.db_url = "mongodb://" + configFile.mongodb.mongodb_username + ":" + configFile.mongodb.mongodb_password + "@" + configFile.mongodb.mongodb_host + ":" + configFile.mongodb.mongodb_port + "?retryWrites=true&w=majority&authSource=" + configFile.mongodb.mongodb_database;
		} else {
			this.db_url = "mongodb://" + configFile.mongodb.mongodb_host + ":" + configFile.mongodb.mongodb_port;
		}
		this.db_name = configFile.mongodb.mongodb_database;
		this.telegramAlert = telegramAlert;
		this.mclient = new MongoClient(this.db_url);
	}

	async connect() {
		await this.mclient.connect();
		Logger.log("Mongodb connected");
		this.mdb = this.mclient.db(this.db_name);

		this.mclient.on('close', this.retry_connection);
		this.mclient.on('reconnect', this.reconnected);
	}

	async disconnect() {
		await this.mclient.close();
		Logger.log("Mongodb disconnected");
	}

	retry_connection() {
		Logger.error("Lost Database connection, retrying...");
		this.telegramAlert.send_msg("ERROR with depth_connector_mongo.js websocket!");
	}

	reconnected() {
		Logger.log("MongoDB reconnected, go back to sleep");
		this.telegramAlert.send_msg("MongoDB reconnected");
	}

	async getCollectionStats() {
		let status: MongoDBstats = await this.mdb?.stats() as MongoDBstats;
		return status;
	}
}

let lastTimeout: NodeJS.Timeout;


module Logger {
	let configFile: ConfigFile;
	export function log(msg: String) {
		if (configFile.general.enable_log) {
			console.log(msg);
		}
	}

	export function error(msg: String) {
		if (configFile.general.enable_err) {
			console.error(msg);
		}
	}

	export function setConfig(config: ConfigFile) {
		configFile = config;
	}
}

async function main() {

	// read config file
	nconf.file({ file: 'mongodb_alert.json' });
	
	let configFile: ConfigFile = nconf.get();
	Logger.setConfig(configFile);
	Logger.log("starting up...");

	var notifier: TelegramNotifyer = new TelegramNotifyer(configFile);
	
	let mdb = new MongoDBconnector(configFile, notifier);
	await mdb.connect();

	notifier.send_msg("[" + os.hostname() + "] " + path.basename(__filename) + " started");

	let old_stats: MongoDBstats;

	let default_timeout: number = configFile.general.default_timeout;
	let timeout_limit: number = configFile.general.timeout_limit;
	let timeout: number = default_timeout;

	// check the database for new entries with backoff function
	let checkFunction = async function() {
		let areThereNoDatabaseUpdates = false;
		try {
			let stats = await mdb.getCollectionStats();

			areThereNoDatabaseUpdates = old_stats && old_stats.objects == stats.objects;
			if (configFile.general.enable_log) {
				console.log(`${Date()} object count: ${stats.objects} Check again in ${timeout/1000} seconds.`);
			}
			old_stats = stats;
		} catch (ex: any) {
			Logger.error(ex);
			areThereNoDatabaseUpdates = true;
		}

		if (areThereNoDatabaseUpdates) {
			notifier.send_msg("No Database Update for " + timeout/1000 + " seconds!\n");
			if ((timeout*2) < timeout_limit) {
				timeout = timeout*2;
			} else {
				timeout = timeout_limit;
			}
		} else {
			timeout = default_timeout;
		}

		
		lastTimeout = setTimeout(checkFunction, timeout);
	};
	checkFunction();

	process.on("SIGINT", async function() {
		Logger.log("Caught SIGINT Signal");
		await mdb.disconnect();

		if (lastTimeout) {
			clearTimeout(lastTimeout);
		}
	})
}

main();
