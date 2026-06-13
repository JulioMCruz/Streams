/**
 * Tests for utils/abis.ts — ABI loader.
 *
 * Audit findings:
 * - The three protocol ABIs are loaded from the compiled Hardhat artifacts
 *   at import time; the test environment must have run `contracts compile`.
 * - loadAbi throws a clear, actionable error when an artifact is missing
 *   (covered by stubbing fs.existsSync and re-importing with a cache-buster,
 *   since the module is otherwise loaded once and cached).
 * - erc20Abi is a static literal exposing balanceOf/decimals/symbol.
 */

import fs from 'node:fs'

import { expect } from 'chai'
import sinon from 'sinon'

import {
  erc20Abi,
  smartAccountAbi,
  streamVaultsAbi,
  streamVaultsConfigAbi,
} from '../../src/utils/abis.js'

describe('utils/abis', function () {
  afterEach(function () {
    sinon.restore()
  })

  it('Should load the three protocol ABIs as non-empty arrays', function () {
    for (const abi of [streamVaultsAbi, streamVaultsConfigAbi, smartAccountAbi]) {
      expect(abi).to.be.an('array')
      expect(abi.length).to.be.greaterThan(0)
    }
  })

  it('Should expose a static erc20Abi with balanceOf/decimals/symbol', function () {
    const names = erc20Abi.map(e => e.name)
    expect(names).to.include.members(['balanceOf', 'decimals', 'symbol'])
    const balanceOf = erc20Abi.find(e => e.name === 'balanceOf')!
    expect(balanceOf.stateMutability).to.equal('view')
    expect(balanceOf.inputs[0].type).to.equal('address')
  })

  it('Should throw an actionable error when an artifact file is missing', async function () {
    sinon.stub(fs, 'existsSync').returns(false)
    // Cache-busting query forces tsx to re-evaluate the module body so the
    // missing-artifact branch runs against the stubbed fs.
    await expect(
      import('../../src/utils/abis.ts?missing=' + Date.now()),
    ).to.be.rejectedWith(/Artifact not found/)
  })
})
