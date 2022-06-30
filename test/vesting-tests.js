const { expect } = require('chai');
const { BigNumber } = require('ethers');
const { ethers, upgrades } = require('hardhat');
const erc20Abi = require('../artifacts/@openzeppelin/contracts/token/ERC20/ERC20.sol/ERC20.json').abi;

async function now() {
  const blockNumber = await ethers.provider.getBlockNumber();
  const block = await ethers.provider.getBlock(blockNumber);
  return block.timestamp;
}

async function advanceMonths(months) {
  await hre.network.provider.send('evm_increaseTime', [3600 * 24 * 30 * months]);
  await hre.network.provider.send('evm_mine');
}

async function advanceMonth() {
  await advanceMonths(1);
}

describe('Vesting & Buying', () => {
  let token;
  let oldToken;
  let vestingContract;
  let usdt;
  let usdc;
  let busd;
  let owner;
  let addr1;
  let addr2;
  let addrs;
  const initialSupply = ethers.BigNumber.from(10).pow(18).mul(1000000000);
  const usdtHolder = '0xF977814e90dA44bFA03b6295A0616a897441aceC';
  const usdcHolder = '0xf977814e90da44bfa03b6295a0616a897441acec';
  const busdHolder = '0x8894e0a0c962cb723c1976a4421c95949be2d4e3';
  const oldShapeOwnerAddr = '0xaf8e65fb718e4bb114bd37bafe6d5bebd411ddde';

  beforeEach(async () => {
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

    const oldShapeAddress = '0xD1A890f7F3a000Eb77CF40774c6f855818Ce1bdC';
    oldToken = new ethers.Contract(oldShapeAddress, erc20Abi, owner);

    factory = await ethers.getContractFactory('SHAPEToken');
    token = await upgrades.deployProxy(factory, [owner.address, initialSupply]);

    const usdtAddress = '0x55d398326f99059fF775485246999027B3197955';
    const busdAddress = '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56';
    const usdcAddress = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';

    factory = await ethers.getContractFactory('SHAPEVesting');
    vestingContract = await upgrades.deployProxy(factory, [
      owner.address,
      oldToken.address,
      token.address,
      usdtAddress,
      busdAddress,
      usdcAddress
    ]);
    await vestingContract.deployed();

    let txn = await token.increaseAllowance(vestingContract.address, await token.balanceOf(owner.address));
    await txn.wait();

    let decimals = await token.decimals();
    // Supply enough tokens for the 4 reserves.
    token.transfer(vestingContract.address, BigNumber.from(10).pow(decimals).mul(225000000));

    usdt = new ethers.Contract(usdtAddress, erc20Abi, owner);
    usdc = new ethers.Contract(usdcAddress, erc20Abi, owner);
    busd = new ethers.Contract(busdAddress, erc20Abi, owner);

    await hre.network.provider.send("hardhat_setBalance", [
      owner.address,
      '0x3635C9ADC5DEA00000',
    ]);

    // Impersonate USDT holder and supply owner with 1000 USDT.
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [usdtHolder]
    });

    let signer = await ethers.getSigner(usdtHolder);
    decimals = await usdt.decimals();
    await usdt.connect(signer).transfer(owner.address, ethers.BigNumber.from(10).pow(decimals).mul(1000));

    await hre.network.provider.request({
      method: 'hardhat_stopImpersonatingAccount',
      params: [usdtHolder]
    });

    // Impersonate USDC holder and supply owner with 1000 USDC.
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [usdcHolder]
    });

    signer = await ethers.getSigner(usdcHolder);
    decimals = await usdc.decimals();
    await usdc.connect(signer).transfer(owner.address, BigNumber.from(10).pow(decimals).mul(1000));

    await hre.network.provider.request({
      method: 'hardhat_stopImpersonatingAccount',
      params: [usdcHolder]
    });

    // Impersonate BUSD holder and supply owner with 1000 BUSD.
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [busdHolder]
    });

    signer = await ethers.getSigner(busdHolder);
    decimals = await busd.decimals();
    await busd.connect(signer).transfer(owner.address, BigNumber.from(10).pow(decimals).mul(1000));

    await hre.network.provider.request({
      method: 'hardhat_stopImpersonatingAccount',
      params: [busdHolder]
    });
  });

  describe('Vesting', () => {
    it('Should allow (only) the owner to change vesting and lock length.', async () => {
      expect(await vestingContract.vesting()).to.equal(0);
      expect(await vestingContract.lock()).to.equal(0);

      await vestingContract.setVesting(30, 60);

      expect(await vestingContract.lock()).to.equal(30);
      expect(await vestingContract.vesting()).to.equal(60);

      await expect(vestingContract.connect(addr1).setVesting(1, 2)).to.be.reverted;
    });

    it('Should allow (only) the owner to change vesting start timestamp.', async () => {
      const timestamp = await now();
      await vestingContract.setVestingStart(timestamp);

      expect(await vestingContract.vestingStart()).to.equal(timestamp);

      await expect(vestingContract.connect(addr1).setVestingStart(timestamp + 1)).to.be.reverted;
    });

    it('Should add to reserves only if vesting starts in the future.', async () => {
      const timestamp = await now();
      const reserveType = 1;
      const toAdd = 1;
      const initialAmount = await vestingContract.checkReserve(reserveType);

      await vestingContract.setVestingStart(timestamp - 10000000);

      await expect(vestingContract.addReserve(reserveType, toAdd)).to.be.reverted;

      await vestingContract.setVestingStart(timestamp + 10000000);

      const txn = await vestingContract.addReserve(reserveType, toAdd);
      await txn.wait();

      expect(await vestingContract.checkReserve(reserveType)).to.equal(initialAmount.add(toAdd));
    });

    describe('Reserves', () => {
      async function testMinExpectedAmount(reserve, tge = 0) {
        let txn = await vestingContract.setVestingStart(await now());
        await txn.wait();

        let {initialAmount, lock, vesting} = (await vestingContract.reserves(reserve));

        if (tge !== 0) {
          initialAmount = initialAmount.sub(initialAmount.mul(tge).div(100));
        }

        expect(await vestingContract.checkMinExpectedReserve(reserve)).to.equal(initialAmount);

        await advanceMonths(lock.div(30));

        expect(await vestingContract.checkMinExpectedReserve(reserve)).to.equal(initialAmount);

        await advanceMonth();

        expect(await vestingContract.checkMinExpectedReserve(reserve)).to.equal(initialAmount.sub(initialAmount.div(vesting.div(30))));

        await advanceMonth();

        expect(await vestingContract.checkMinExpectedReserve(reserve)).to.equal(initialAmount.sub(initialAmount.div(vesting.div(30)).mul(2)));

        await advanceMonths(vesting.div(30).sub(2));

        expect(await vestingContract.checkMinExpectedReserve(reserve)).to.equal(0);
      }

      async function testWithdrawing(reserve, tge = 0) {
        let txn = await vestingContract.setVestingStart(await now());
        await txn.wait();

        let {initialAmount, lock, vesting} = await vestingContract.reserves(reserve);

        const tgeAmount = initialAmount.mul(tge).div(100);
        if (tge !== 0) {
          initialAmount = initialAmount.sub(tgeAmount);
        }

        const perMonth = initialAmount.div(vesting.div(30));
        const initialBalance = await token.balanceOf(owner.address);

        txn = await vestingContract.withdrawFromReserve(reserve, tgeAmount);
        await txn.wait();

        expect(await token.balanceOf(owner.address)).to.equal(initialBalance.add(tgeAmount));

        await expect(vestingContract.withdrawFromReserve(reserve, perMonth)).to.be.revertedWith('Requested more than allowed by the vesting schedule.');

        await advanceMonths(lock.div(30));

        await expect(vestingContract.withdrawFromReserve(reserve, perMonth)).to.be.revertedWith('Requested more than allowed by the vesting schedule.');

        await advanceMonth();

        txn = await vestingContract.withdrawFromReserve(reserve, perMonth);
        await txn.wait();

        expect(await token.balanceOf(owner.address)).to.equal(initialBalance.add(tgeAmount).add(perMonth));

        await advanceMonths(vesting.div(30) - 1);

        txn = await vestingContract.withdrawFromReserve(reserve, perMonth.mul(vesting.div(30) - 1));
        await txn.wait();

        expect(await token.balanceOf(owner.address)).to.equal(initialBalance.add(tgeAmount).add(perMonth.mul(vesting.div(30))));
      }

      describe('Team', () => {
        let TEAM;

        beforeEach(async () => {
          TEAM = await vestingContract.TEAM();
        });

        it('Should correctly compute the minimum expected amount in reserve.', async () => {
          await testMinExpectedAmount(TEAM);
        });

        it('Should withdraw from reserves according to schedule.', async () => {
          await testWithdrawing(TEAM);
        });
      });

      describe('Marketing', () => {
        let MARKETING;

        beforeEach(async () => {
          MARKETING = await vestingContract.MARKETING();
        });

        it('Should correctly compute the minimum expected amount in reserve.', async () => {
          await testMinExpectedAmount(MARKETING);
        });

        it('Should withdraw from reserves according to schedule.', async () => {
          await testWithdrawing(MARKETING);
        });
      });

      describe('Company reserve', () => {
        let RESERVE;

        beforeEach(async () => {
          RESERVE = await vestingContract.RESERVE();
        });

        it('Should correctly compute the minimum expected amount in reserve.', async () => {
          await testMinExpectedAmount(RESERVE);
        });

        it('Should withdraw from reserves according to schedule.', async () => {
          await testWithdrawing(RESERVE);
        });
      });

      describe('Liquidity and staking', () => {
        let LIQUIDITY;

        beforeEach(async () => {
          LIQUIDITY = await vestingContract.LIQUIDITY();
        });

        it('Should correctly compute the minimum expected amount in reserve.', async () => {
          await testMinExpectedAmount(LIQUIDITY, 20);
        });

        it('Should withdraw from reserves according to schedule.', async () => {
          await testWithdrawing(LIQUIDITY, 20);
        });
      });
    });

    it('Should exchange old tokens for new ones.', async () => {
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [oldShapeOwnerAddr]
      });

      const oldShapeOwner = await ethers.getSigner(oldShapeOwnerAddr);

      await hre.network.provider.send("hardhat_setBalance", [
        oldShapeOwner.address,
        '0x3635C9ADC5DEA00000',
      ]);

      let txn = await oldToken.connect(oldShapeOwner).increaseAllowance(vestingContract.address, await oldToken.balanceOf(oldShapeOwner.address));
      await txn.wait();

      const oldTokenBalance = await oldToken.balanceOf(oldShapeOwner.address);
      const toClaim = 1;

      txn = await vestingContract.setVesting(0, 0);
      await txn.wait();

      txn = await vestingContract.connect(oldShapeOwner).claimNewShape(toClaim);
      await txn.wait();

      expect(await oldToken.balanceOf(oldShapeOwner.address)).to.equal(oldTokenBalance.sub(toClaim));

      // Claim from the first (0th) vesting schedule
      txn = await vestingContract.connect(oldShapeOwner).claim(0);
      await txn.wait();
      expect(await token.balanceOf(oldShapeOwner.address)).to.equal(toClaim);

      await hre.network.provider.request({
        method: 'hardhat_stopImpersonatingAccount',
        params: [oldShapeOwnerAddr]
      });
    });

    it('Should claim tokens according to vesting schedule.', async () => {
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [oldShapeOwnerAddr]
      });

      const oldShapeOwner = await ethers.getSigner(oldShapeOwnerAddr);

      await hre.network.provider.send("hardhat_setBalance", [
        oldShapeOwner.address,
        '0x3635C9ADC5DEA00000',
      ]);

      const oldTokenBalance = await oldToken.balanceOf(oldShapeOwner.address);
      let txn = await oldToken.connect(oldShapeOwner).increaseAllowance(vestingContract.address, oldTokenBalance);
      await txn.wait();

      const toClaim = BigNumber.from(10).pow(18).mul(3);

      txn = await vestingContract.setVestingStart(await now());
      await txn.wait();
      txn = await vestingContract.setVesting(30, 90);
      await txn.wait();

      txn = await vestingContract.connect(oldShapeOwner).claimNewShape(toClaim);
      await txn.wait();

      expect(await oldToken.balanceOf(oldShapeOwner.address)).to.equal(oldTokenBalance.sub(toClaim));

      txn = await vestingContract.connect(oldShapeOwner).claim(0);
      await txn.wait();
      expect(await token.balanceOf(oldShapeOwner.address)).to.equal(0);

      // Pass time for lock period
      await advanceMonth();

      txn = await vestingContract.connect(oldShapeOwner).claim(0);
      await txn.wait();
      expect(await token.balanceOf(oldShapeOwner.address)).to.equal(0);

      // Pass first month of vesting, should allow taking out 1/3 of funds
      await advanceMonth();

      txn = await vestingContract.connect(oldShapeOwner).claim(0);
      await txn.wait();
      expect(await token.balanceOf(oldShapeOwner.address)).to.equal(BigNumber.from(10).pow(18));

      // Next two months of vesting, should allow withdrawing all funds left
      await advanceMonths(2);

      txn = await vestingContract.connect(oldShapeOwner).claim(0);
      await txn.wait();
      expect(await token.balanceOf(oldShapeOwner.address)).to.equal(BigNumber.from(10).pow(18).mul(3));

      await hre.network.provider.request({
        method: 'hardhat_stopImpersonatingAccount',
        params: [oldShapeOwnerAddr]
      });
    });
  });

  describe('Buying', () => {
    it('Should allow (only) the owner to set the price.', async () => {
      expect(await vestingContract.price()).to.equal(0);
      await vestingContract.setPrice(10);
      expect(await vestingContract.price()).to.equal(10);

      await expect(vestingContract.connect(addr1).setPrice(11)).to.be.reverted;
    });

    it('Should allow buying SHAPE with BUSD and withdrawing BUSD.', async () => {
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [busdHolder]
      });

      signer = await ethers.getSigner(busdHolder);

      let txn = await busd.increaseAllowance(vestingContract.address, await busd.balanceOf(busdHolder));
      await txn.wait();

      const previousAmountBuyer = await busd.balanceOf(busdHolder);
      const previousAmountOwner = await busd.balanceOf(owner.address);
      const price = await vestingContract.price();
      const priceDecimals = 18;
      const decimals = await token.decimals();
      const amount = ethers.BigNumber.from(10).pow(decimals);

      txn = await vestingContract.setVesting(0, 0);
      await txn.wait();

      txn = await vestingContract.connect(signer).buyShapeBUSD(amount);
      await txn.wait();

      expect(await busd.balanceOf(busdHolder)).to.equal(previousAmountBuyer.sub(amount.mul(price).div(priceDecimals)));
      expect((await vestingContract.vestingSchedules(busdHolder, 0)).initialAmount).to.equal(amount);

      await hre.network.provider.request({
        method: 'hardhat_stopImpersonatingAccount',
        params: [busdHolder]
      });

      txn = await vestingContract.withdrawBUSD();
      await txn.wait();

      expect(await busd.balanceOf(owner.address)).to.equal(previousAmountOwner);

      await hre.network.provider.send('evm_increaseTime', [3600 * 24]);
      await hre.network.provider.send('evm_mine');

      txn = await vestingContract.withdrawBUSD();
      await txn.wait();

      expect(await busd.balanceOf(owner.address)).to.equal(previousAmountOwner.add(amount.mul(price).div(priceDecimals)));
    });

    it('Should allow buying SHAPE with USDT and withdrawing USDT.', async () => {
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [usdtHolder]
      });

      signer = await ethers.getSigner(usdtHolder);

      let txn = await usdt.increaseAllowance(vestingContract.address, await usdt.balanceOf(usdtHolder));
      await txn.wait();

      const previousAmountBuyer = await usdt.balanceOf(usdtHolder);
      const previousAmountOwner = await usdt.balanceOf(owner.address);
      const price = await vestingContract.price();
      const priceDecimals = 18;
      const decimals = await token.decimals();
      const amount = ethers.BigNumber.from(10).pow(decimals);

      txn = await vestingContract.setVesting(0, 0);
      await txn.wait();

      txn = await vestingContract.connect(signer).buyShapeUSDT(amount);
      await txn.wait();

      expect(await usdt.balanceOf(usdtHolder)).to.equal(previousAmountBuyer.sub(amount.mul(price).div(priceDecimals)));
      expect((await vestingContract.vestingSchedules(usdtHolder, 0)).initialAmount).to.equal(amount);

      await hre.network.provider.request({
        method: 'hardhat_stopImpersonatingAccount',
        params: [usdtHolder]
      });

      txn = await vestingContract.withdrawUSDT();
      await txn.wait();

      expect(await usdt.balanceOf(owner.address)).to.equal(previousAmountOwner);

      await hre.network.provider.send('evm_increaseTime', [3600 * 24]);
      await hre.network.provider.send('evm_mine');

      txn = await vestingContract.withdrawUSDT();
      await txn.wait();

      expect(await usdt.balanceOf(owner.address)).to.equal(previousAmountOwner.add(amount.mul(price).div(priceDecimals)));
    });

    it('Should allow buying SHAPE with USDC and withdrawing USDC.', async () => {
      await hre.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [usdcHolder]
      });

      signer = await ethers.getSigner(usdcHolder);

      let txn = await usdc.increaseAllowance(vestingContract.address, await usdc.balanceOf(usdcHolder));
      await txn.wait();

      const previousAmountBuyer = await usdc.balanceOf(usdcHolder);
      const previousAmountOwner = await usdc.balanceOf(owner.address);
      const price = await vestingContract.price();
      const priceDecimals = 18;
      const decimals = await token.decimals();
      const amount = ethers.BigNumber.from(10).pow(decimals);

      txn = await vestingContract.setVesting(0, 0);
      await txn.wait();

      txn = await vestingContract.connect(signer).buyShapeUSDC(amount);
      await txn.wait();

      expect(await usdc.balanceOf(usdcHolder)).to.equal(previousAmountBuyer.sub(amount.mul(price).div(priceDecimals)));
      expect((await vestingContract.vestingSchedules(usdcHolder, 0)).initialAmount).to.equal(amount);

      await hre.network.provider.request({
        method: 'hardhat_stopImpersonatingAccount',
        params: [usdcHolder]
      });

      txn = await vestingContract.withdrawUSDC();
      await txn.wait();

      expect(await usdc.balanceOf(owner.address)).to.equal(previousAmountOwner);

      await hre.network.provider.send('evm_increaseTime', [3600 * 24]);
      await hre.network.provider.send('evm_mine');

      txn = await vestingContract.withdrawUSDC();
      await txn.wait();

      expect(await usdc.balanceOf(owner.address)).to.equal(previousAmountOwner.add(amount.mul(price).div(priceDecimals)));
    });
  });
});