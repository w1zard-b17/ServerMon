#!/bin/sh
# starts the collection engine in the foreground, logging to a file.
# template: provision.sh replaces __PROJECT__ and installs it under bin/

cd __PROJECT__
exec __PROJECT__/v/bin/python main.py >> __PROJECT__/logs/servermon.log 2>&1
