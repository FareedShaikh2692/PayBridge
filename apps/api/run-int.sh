#!/usr/bin/env bash
# Runs integration tests with a hard time limit and prints a trimmed report.
LOG=/tmp/pb-int.log
(npx jest --config jest.int.config.js --runInBand "$@" > $LOG 2>&1 &)
for i in $(seq 1 ${PB_WAIT:-48}); do sleep 5; grep -q "Test Suites:" $LOG && break; done
grep -v "^\s*at \|node_modules/" $LOG | tail -${PB_TAIL:-90}
