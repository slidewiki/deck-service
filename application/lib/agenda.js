'use strict';

let Agenda = require('agenda');
let helper = require('../database/helper.js');


let self = module.exports = {
    getAgenda : () => {
        return helper.connectToDatabase()
        .then((db) => {
            let agenda = new Agenda().mongo(db, 'jobs');
            return agenda;
        })
        .catch((err) => {
            return;
        });

    },
    startAgenda : (agenda) => {

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
