require('@nomiclabs/hardhat-waffle');
require('@openzeppelin/hardhat-upgrades');
require('hardhat-deploy');
require('@nomiclabs/hardhat-ethers');
const dotenv = require('dotenv');

dotenv.config();

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    compilers: [
      {version: '0.8.4'},
      {version: '0.5.16'}
    ]
  },
  networks: {
    hardhat: {
      forking: {
        url: 'https://bscrpc.com',
      }
    },
    bscTestnet: {
      url: 'https://data-seed-prebsc-1-s1.binance.org:8545/',
      accounts: [process.env.PRIVATE_KEY]
    },
  },
  etherscan: {
    apiKey: 'I97MD1WUVM1JMBXBP2G6V7GHMJFTABTXKX'
  },
  namedAccounts: {
    deployer: {
      default: 0
    }
  }
};
