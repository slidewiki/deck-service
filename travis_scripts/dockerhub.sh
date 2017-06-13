#!/bin/bash

docker login -u="$DOCKER_USERNAME" -p="$DOCKER_PASSWORD"
docker build -t slidewiki/deckservice:latest-dev ./
docker push slidewiki/deckservice:latest-dev
