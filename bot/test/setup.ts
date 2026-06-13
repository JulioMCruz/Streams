/**
 * Global Mocha setup — loaded before any spec via `.mocharc.json` `file`.
 * Registers chai-as-promised so specs can use `.to.be.rejectedWith(...)`
 * and `.to.be.fulfilled` on promise assertions.
 */
import * as chai from 'chai'
import chaiAsPromised from 'chai-as-promised'

chai.use(chaiAsPromised)
