'use strict';

let Agenda = require('agenda');
let helper = require('../database/helper.js');


let self = module.exports = {
    getAgenda : async () => {
        let db = await helper.connectToDatabase()
        let agenda = await new Agenda().mongo(db, 'jobs');
        await new Promise(resolve => agenda.once('ready', resolve));
        return agenda;
    },
    startAgenda : async (agenda) => {

        let jobTypes = process.env.JOB_TYPES ? process.env.JOB_TYPES.split(',') : [];

        jobTypes.forEach((type) => {
            require('./jobs/' + type)(agenda);
        });

        if(jobTypes.length) {
            agenda.start();
            console.log('Agenda listener is waiting for jobs');
        }

    }
};
