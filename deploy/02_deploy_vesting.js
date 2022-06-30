const { ethers, upgrades } = require("hardhat");

module.exports = async (_hre) => {
  const factory = await ethers.getContractFactory('SHAPEVesting');
  const vestingContract = await upgrades.deployProxy(factory, [
    process.env.OWNER,
    process.env.OLD_SHAPE_ADDR,
    process.env.SHAPE_ADDR,
    process.env.USDT_ADDR,
    process.env.BUSD_ADDR,
    process.env.USDC_ADDR
  ]);
  await vestingContract.deployed();
  console.log(`Vesting contract deployed to ${vestingContract.address}`);
};
module.exports.tags = ['SHAPE', 'Vesting'];