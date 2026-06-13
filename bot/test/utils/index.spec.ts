/**
 * Tests for utils/index.ts — barrel re-export.
 *
 * Audit findings:
 * - The barrel re-exports everything from ./abis and ./logger so consumers
 *   can `import { getLogger, erc20Abi } from '../utils'`. Verify both
 *   surfaces are reachable through the barrel.
 */

import { expect } from 'chai'

import * as utils from '../../src/utils/index.js'

describe('utils/index', function () {
  it('Should re-export the logger factory', function () {
    expect(utils.getLogger).to.be.a('function')
  })

  it('Should re-export the ABI surface', function () {
    expect(utils.erc20Abi).to.be.an('array')
    expect(utils.streamVaultsAbi).to.be.an('array')
    expect(utils.streamVaultsConfigAbi).to.be.an('array')
    expect(utils.smartAccountAbi).to.be.an('array')
  })
})
