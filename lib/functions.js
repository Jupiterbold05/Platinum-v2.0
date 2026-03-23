const fs = require('fs').promises;
const axios = require('axios');

const getBuffer = async (url, options) => {
	try {
		options ? options : {};
		var res = await axios({
			method: 'get',
			url,
			headers: {
				'DNT': 1,
				'Upgrade-Insecure-Request': 1
			},
			...options,
			responseType: 'arraybuffer'
		});
		return res.data;
	} catch (e) {
		console.log(e);
	}
};

const getLocalBuffer = async (path) => {
	try {
		return await fs.readFile(path);
	} catch (error) {
		console.error(`Error reading file: ${path}`, error);
		return null;
	}
};

const getGroupAdmins = (participants) => {
	var admins = [];
	for (let i of participants) {
		i.admin !== null ? admins.push(i.id) : '';
	}
	return admins;
};

const getRandom = (ext) => {
	return `${Math.floor(Math.random() * 10000)}${ext}`;
};

const h2k = (eco) => {
	var lyrik = ['', 'K', 'M', 'B', 'T', 'P', 'E'];
	var ma = Math.log10(Math.abs(eco)) / 3 | 0;
	if (ma == 0) return eco;
	var ppo = lyrik[ma];
	var scale = Math.pow(10, ma * 3);
	var scaled = eco / scale;
	var formatt = scaled.toFixed(1);
	if (/\.0$/.test(formatt))
		formatt = formatt.substr(0, formatt.length - 2);
	return formatt + ppo;
};

const isUrl = (url) => {
	return url.match(
		new RegExp(
			/https?:\/\/(www\.)?[-a-zA-Z0-9@:%.+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%+.~#?&/=]*)/,
			'gi'
		)
	);
};

const Json = (string) => {
    return JSON.stringify(string, null, 2);
};

const runtime = (seconds) => {
	seconds = Number(seconds);
	var d = Math.floor(seconds / (3600 * 24));
	var h = Math.floor((seconds % (3600 * 24)) / 3600);
	var m = Math.floor((seconds % 3600) / 60);
	var s = Math.floor(seconds % 60);
	var dDisplay = d > 0 ? d + (d == 1 ? ' day, ' : ' days, ') : '';
	var hDisplay = h > 0 ? h + (h == 1 ? ' hour, ' : ' hours, ') : '';
	var mDisplay = m > 0 ? m + (m == 1 ? ' minute, ' : ' minutes, ') : '';
	var sDisplay = s > 0 ? s + (s == 1 ? ' second' : ' seconds') : '';
	return dDisplay + hDisplay + mDisplay + sDisplay;
};

const sleep = async (ms) => {
	return new Promise(resolve => setTimeout(resolve, ms));
};

const fetchJson = async (url, options) => {
    try {
        options ? options : {};
        const res = await axios({
            method: 'GET',
            url: url,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36'
            },
            ...options
        });
        return res.data;
    } catch (err) {
        return err;
    }
};

const formatBytes = (bytes, decimals = 2) => {
	if (!+bytes) return "0 Bytes";

	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

	const i = Math.floor(Math.log(bytes) / Math.log(k));

	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

module.exports = { 
	getBuffer, 
	getLocalBuffer, 
	getGroupAdmins, 
	getRandom, 
	h2k, 
	isUrl, 
	Json, 
	runtime, 
	sleep, 
	fetchJson, 
	formatBytes 
};