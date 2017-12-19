'use strict';

let Agenda = require('agenda');
let helper = require('../database/helper.js');


let self = module.exports = {
    getAgenda : () => {
        return helper.connectToDatabase().then((db) => {
            let agenda = new Agenda().mongo(db, 'jobs');

            //await new Promise(resolve => agenda.once('ready', resolve));

            let jobTypes = process.env.JOB_TYPES ? process.env.JOB_TYPES.split(',') : [];

            jobTypes.forEach((type) => {
                require('./jobs/' + type)(agenda);
            });

            if(jobTypes.length) {
                agenda.start();
            }

            //await new Promise(resolve => agenda.once('ready', resolve));
            return agenda;
        });
    },
};
