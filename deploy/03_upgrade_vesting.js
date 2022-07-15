const { ethers, upgrades } = require("hardhat");

module.exports = async (_hre) => {
  const factory = await ethers.getContractFactory('SHAPEVesting');
  const vestingContract = await upgrades.upgradeProxy(process.env.VESTING_ADDR, factory);
  console.log(`Vesting contract upgraded.`);
};
module.exports.tags = ['VestingUpgrade', 'Vesting', 'Upgrade'];