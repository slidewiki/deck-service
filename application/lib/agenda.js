'use strict';

let Agenda = require('agenda');
let helper = require('../database/helper.js');


let self = module.exports = {
    getAgenda : () => {
        return helper.connectToDatabase()
        .then((db) => {
            let agenda = new Agenda().mongo(db, 'jobs');
            return (agenda);
        })
        .catch((err) => {
            console.log('Agenda cannot connect to the mongoDB');
            return ;
        });;
    },
    startAgenda : (agenda) => {

        let jobTypes = process.env.JOB_TYPES ? process.env.JOB_TYPES.split(',') : [];

        jobTypes.forEach((type) => {
            require('./jobs/' + type)(agenda);
        });

        if(jobTypes.length) {
            try {
                agenda.start();
                console.log('Agenda listener is waiting for jobs');
            }catch(err){
                console.log('Cannot start agenda listener, error: %s', err);
            }

        }else{
            console.log('Agenda listener was called without any jobs specified');
        }

    }
};
