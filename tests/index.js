/* eslint-env node */
import * as basic from './basic.tests.js'

import { runTests } from 'lib0/testing'
import { isBrowser, isNode } from 'lib0/environment'
import * as log from 'lib0/logging'

if (isBrowser) {
  log.createVConsole(document.body)
}

const tests = {
  basic
}

const run = async () => {
  const success = await runTests(tests)
  /* istanbul ignore next */
  if (isNode) {
    process.exit(success ? 0 : 1)
  }
}
run()
