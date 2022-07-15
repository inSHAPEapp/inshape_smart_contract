const { expect } = require('chai');
const { BigNumber } = require('ethers');
const { ethers, upgrades } = require('hardhat');

describe('inSHAPE Token', () => {
  let token;
  let owner;
  let addr1;
  let addr2;
  let addrs;
  const initialSupply = ethers.BigNumber.from(10).pow(18).mul(1000000000);

  beforeEach(async () => {
    const tokenFactory = await ethers.getContractFactory('SHAPEToken');
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
    token = await upgrades.deployProxy(tokenFactory, [owner.address]);

    const txn = await token.mint(initialSupply);
    await txn.wait();
  });

  it('Should have a max supply of 1,000,000,000 tokens.', async () => {
    expect(token.mint(1)).to.be.reverted;
  });

  it('Should allow burning and minting for owner.', async () => {
    let txn = await token.burn(100);
    await txn.wait();

    expect(await token.totalSupply()).to.equal(initialSupply.sub(100));
    expect(await token.balanceOf(owner.address)).to.equal(initialSupply.sub(100));

    txn = await token.mint(100);
    await txn.wait();

    expect(await token.totalSupply()).to.equal(initialSupply);
    expect(await token.balanceOf(owner.address)).to.equal(initialSupply);
  });

  it('Shouldn\'t allow burning and minting for everyone else.', async () => {
    expect(token.connect(addr1).burn(1)).to.be.revertedWith('Ownable: caller is not the owner');
    expect(token.connect(addr1).mint(1)).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it('Should be able to lock and transfer locked tokens to the owner.', async () => {
    const transferAmount = BigNumber.from(600);
    let txn = await token.transfer(addr1.address, transferAmount);
    await txn.wait();

    expect(await token.balanceOf(addr1.address)).to.equal(transferAmount);

    const lockedAmount = transferAmount.sub(100);
    txn = await token.lock(addr1.address, lockedAmount);
    await txn.wait();

    expect(await token.locked(addr1.address)).to.equal(lockedAmount);

    expect(token.connect(addr1).transfer(addr2.address,  transferAmount.sub(lockedAmount).add(1)))
      .to.be.revertedWith('Locked tokens can only be transfered to the owner of the contract.');

    txn = await token.connect(addr1).transfer(addr2.address, transferAmount.sub(lockedAmount));
    await txn.wait();

    expect(await token.balanceOf(addr1.address)).to.equal(lockedAmount);
    expect(await token.balanceOf(addr2.address)).to.equal(transferAmount.sub(lockedAmount));

    expect(token.connect(addr1).transfer(addr2.address, 1))
      .to.be.revertedWith('Locked tokens can only be transfered to the owner of the contract.');

    txn = await token.connect(addr1).transfer(owner.address, lockedAmount);
    await txn.wait();

    expect(await token.balanceOf(addr1.address)).to.equal(BigNumber.from(0));
  });
});