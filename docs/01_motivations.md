# Motivations

## Learning by Doing

The best way to learn is by doing, and taking the least amount of baggage with you. So I have approached this by being completely naive and not trying to learn everything all at once. I have tried to learn the bare minimum to get started and then build on that knowledge as I go. This helps me understand much bigger projects and how they work, by helping me understand the problems they are trying to solve. More learning by fire than book learning.

## Use in my Projects

I have two very different side projects that I am working on, where intelligent retreival is required:

- A front end to the SEC Edgar database where you can ask questions. It originally started as a way to investigate SPACs during the 2021 SPAC boom. The current state of the app is at [embarc.com](https://embarc.com).
- An app that pulls all the data about me from all over the internet and my devices and puts it in one app that I can then ask questions of. Like, "How did I meet so and so" and it checks when we connected on LinkedIn, cross references with my calendar and also my location history for that day and the days before.

## Goals

This project is an attempt to build a framework that can be used to build intelligent retrieval systems. The main requirements are:

- I need the ability to test and iterate quickly on ideas, models, and data using both local and cloud resources. And compare the results of different approaches.
- Be able to put into production and decide to change approaches later without having to rewrite everything. So switching embedding models part way through a project should be easy.
- When there is a lot of processing, particularly locally, it needs to be resumable -- the user may close the app while it is processing and then come back to it later.
