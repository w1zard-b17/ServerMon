#!/bin/sh
# starts the dashboard API in the foreground, logging to a file.
# template: provision.sh replaces __PROJECT__ and installs it under bin/

cd __PROJECT__
exec __PROJECT__/v/bin/python -m api.server >> __PROJECT__/logs/servermon-api.log 2>&1
