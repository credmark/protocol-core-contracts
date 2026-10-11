import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { MockCMK } from '../typechain-types';

describe('Mock Credmark', () => {
  let cmk: MockCMK;
  let wallet: SignerWithAddress;
  let walletTo: SignerWithAddress;

  const fixture = async () => {
    const factory = await ethers.getContractFactory('MockCMK');
    return (await factory.deploy()) as MockCMK;
  };

  beforeEach(async () => {
    cmk = await loadFixture(fixture);
    [wallet, walletTo] = await ethers.getSigners();
  });

  it('should assign initial balance', async () => {
    expect(await cmk.balanceOf(await wallet.getAddress())).to.equal(
      BigInt(10) ** 18n * 100000000n
    );
  });

  it('should add amount to destination account on transfer', async () => {
    await cmk.transfer(await walletTo.getAddress(), 7);
    expect(await cmk.balanceOf(await walletTo.getAddress())).to.equal(7);
  });

  it('should emit transfer event', async () => {
    await expect(cmk.transfer(await walletTo.getAddress(), 7))
      .to.emit(cmk, 'Transfer')
      .withArgs(await wallet.getAddress(), await walletTo.getAddress(), 7);
  });

  it('can not transfer above the amount', async () => {
    await expect(
      cmk.transfer(
        await walletTo.getAddress(),
        BigInt(10) ** 18n * 100000000n + 1n
      )
    ).to.be.reverted;
  });

  it('can not transfer from empty account', async () => {
    const tokenFromOtherWallet = cmk.connect(walletTo);
    await expect(tokenFromOtherWallet.transfer(await wallet.getAddress(), 1)).to.be
      .reverted;
  });

  it('can not transfer when paused', async () => {
    await cmk.pause();
    await expect(cmk.transfer(await walletTo.getAddress(), 1)).to.be.reverted;
  });

  it('can transfer when unpaused', async () => {
    await cmk.pause();
    await expect(cmk.transfer(await walletTo.getAddress(), 7)).to.be.reverted;
    await cmk.unpause();
    await cmk.transfer(await walletTo.getAddress(), 7);
    expect(await cmk.balanceOf(await walletTo.getAddress())).to.equal(7);
  });
});
