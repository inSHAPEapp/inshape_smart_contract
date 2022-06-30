const { BigNumber } = require("ethers");
const { upgrades, ethers } = require("hardhat");

module.exports = async (_hre) => {
  const factory = await ethers.getContractFactory('SHAPEToken');
  const token = await upgrades.deployProxy(factory, [
    process.env.OWNER,
    BigNumber.from(10).pow(18).mul(1000000000)
  ]);
  await token.deployed();
  console.log(`SHAPE token deployed to ${token.address}`);
};
module.exports.tags = ['SHAPE', 'Token'];