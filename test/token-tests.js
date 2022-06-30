const { expect } = require('chai');
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
    token = await upgrades.deployProxy(tokenFactory, [owner.address, initialSupply]);
  });

  it('Should have an initial supply of 1,000,000,000 tokens.', async () => {
    expect(await token.totalSupply()).to.equal(initialSupply);
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
});