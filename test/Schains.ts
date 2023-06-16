import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { ConstantsHolder,
         ContractManager,
         Nodes,
         SchainsInternal,
         SchainsInternalMock,
         Schains,
         SkaleDKGTester,
         SkaleManager,
         ValidatorService,
         NodeRotation,
         Wallets} from "../typechain-types";
import { BigNumber, Wallet } from "ethers";
import { skipTime, currentTime } from "./tools/time";
import { privateKeys } from "./tools/private-keys";
import { deployConstantsHolder } from "./tools/deploy/constantsHolder";
import { deployContractManager } from "./tools/deploy/contractManager";
import { deployValidatorService } from "./tools/deploy/delegation/validatorService";
import { deployNodes } from "./tools/deploy/nodes";
import { deploySchainsInternalMock } from "./tools/deploy/test/schainsInternalMock";
import { deploySchainsInternal } from "./tools/deploy/schainsInternal";
import { deploySchains } from "./tools/deploy/schains";
import { deploySkaleDKGTester } from "./tools/deploy/test/skaleDKGTester";
import { deploySkaleManager } from "./tools/deploy/skaleManager";
import { deployNodeRotation } from "./tools/deploy/nodeRotation";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { assert, expect } from "chai";
import { deployWallets } from "./tools/deploy/wallets";
import { fastBeforeEach } from "./tools/mocha";
import { stringKeccak256 } from "./tools/hashes";
import { getPublicKey, getValidatorIdSignature } from "./tools/signatures";
import { schainParametersType, SchainType } from "./tools/types";

chai.should();
chai.use(chaiAsPromised);

describe("Schains", () => {
    let owner: SignerWithAddress;
    let holder: SignerWithAddress;
    let validator: SignerWithAddress;
    let richGuy1: SignerWithAddress;
    let richGuy2: SignerWithAddress;
    let richGuy3: SignerWithAddress;
    let richGuy4: SignerWithAddress;
    let nodeAddress1: Wallet;
    let nodeAddress2: Wallet;
    let nodeAddress3: Wallet;
    let nodeAddress4: Wallet;

    let constantsHolder: ConstantsHolder;
    let contractManager: ContractManager;
    let schains: Schains;
    let schainsInternal: SchainsInternalMock;
    let schainsInternal2: SchainsInternal;
    let nodes: Nodes;
    let validatorService: ValidatorService;
    let skaleDKG: SkaleDKGTester;
    let skaleManager: SkaleManager;
    let nodeRotation: NodeRotation;
    let wallets: Wallets;

    fastBeforeEach(async () => {
        [owner, holder, validator, richGuy1, richGuy2, richGuy3, richGuy4] = await ethers.getSigners();

        nodeAddress1 = new Wallet(String(privateKeys[3])).connect(ethers.provider);
        nodeAddress2 = new Wallet(String(privateKeys[4])).connect(ethers.provider);
        nodeAddress3 = new Wallet(String(privateKeys[5])).connect(ethers.provider);
        nodeAddress4 = new Wallet(String(privateKeys[0])).connect(ethers.provider);

        await richGuy1.sendTransaction({to: nodeAddress1.address, value: ethers.utils.parseEther("10000")});
        await richGuy2.sendTransaction({to: nodeAddress2.address, value: ethers.utils.parseEther("10000")});
        await richGuy3.sendTransaction({to: nodeAddress3.address, value: ethers.utils.parseEther("10000")});
        await richGuy4.sendTransaction({to: nodeAddress4.address, value: ethers.utils.parseEther("10000")});

        contractManager = await deployContractManager();

        constantsHolder = await deployConstantsHolder(contractManager);
        nodes = await deployNodes(contractManager);
        // await contractManager.setContractsAddress("Nodes", nodes.address);
        schainsInternal = await deploySchainsInternalMock(contractManager);
        schainsInternal2 = await deploySchainsInternal(contractManager);
        await contractManager.setContractsAddress("SchainsInternal", schainsInternal.address);
        schains = await deploySchains(contractManager);
        validatorService = await deployValidatorService(contractManager);
        skaleDKG = await deploySkaleDKGTester(contractManager);
        await contractManager.setContractsAddress("SkaleDKG", skaleDKG.address);
        skaleManager = await deploySkaleManager(contractManager);
        nodeRotation = await deployNodeRotation(contractManager);
        wallets = await deployWallets(contractManager);

        const VALIDATOR_MANAGER_ROLE = await validatorService.VALIDATOR_MANAGER_ROLE();
        await validatorService.grantRole(VALIDATOR_MANAGER_ROLE, owner.address);
        const CONSTANTS_HOLDER_MANAGER_ROLE = await constantsHolder.CONSTANTS_HOLDER_MANAGER_ROLE();
        await constantsHolder.grantRole(CONSTANTS_HOLDER_MANAGER_ROLE, owner.address);
        const NODE_MANAGER_ROLE = await nodes.NODE_MANAGER_ROLE();
        await nodes.grantRole(NODE_MANAGER_ROLE, owner.address);

        await validatorService.connect(validator).registerValidator("D2", "D2 is even", 0, 0);
        const validatorIndex = await validatorService.getValidatorId(validator.address);
        await validatorService.enableValidator(validatorIndex);
        const signature = await getValidatorIdSignature(validatorIndex, nodeAddress1);
        await validatorService.connect(validator).linkNodeAddress(nodeAddress1.address, signature);
        const signature2 = await getValidatorIdSignature(validatorIndex, nodeAddress2);
        await validatorService.connect(validator).linkNodeAddress(nodeAddress2.address, signature2);
        const signature3 = await getValidatorIdSignature(validatorIndex, nodeAddress3);
        await validatorService.connect(validator).linkNodeAddress(nodeAddress3.address, signature3);
        const signature4 = await getValidatorIdSignature(validatorIndex, nodeAddress4);
        await validatorService.connect(validator).linkNodeAddress(nodeAddress4.address, signature4);
        await constantsHolder.setMSR(0);
    });

    describe("should add schain", () => {
        it("should fail when user does not have enough money", async () => {
            await schains.addSchain(
                holder.address,
                5,
                ethers.utils.defaultAbiCoder.encode(
                    [schainParametersType],
                    [{
                        lifetime: 5,
                        typeOfSchain: SchainType.SMALL,
                        nonce: 0,
                        name: "d2",
                        originator: ethers.constants.AddressZero,
                        options: []
                    }]
                )
            ).should.be.eventually.rejectedWith("Not enough money to create Schain");
        });

        it("should not allow everyone to create schains as the foundation", async () => {
            await schains.addSchainByFoundation(5, SchainType.SMALL, 0, "d2", ethers.constants.AddressZero, ethers.constants.AddressZero, [])
                .should.be.eventually.rejectedWith("Sender is not authorized to create schain");
        })

        it("should fail when schain type is wrong", async () => {
            await schains.addSchain(
                holder.address,
                5,
                ethers.utils.defaultAbiCoder.encode(
                    [schainParametersType],
                    [{
                        lifetime: 5,
                        typeOfSchain: 6, // wrong type
                        nonce: 0,
                        name: "d2",
                        originator: ethers.constants.AddressZero,
                        options: []
                    }]
                )
            ).should.be.eventually.rejectedWith("Invalid type of schain");
        });

        it("should fail when data parameter is too short", async () => {
            await schains.addSchain(
                holder.address,
                5,
                ethers.utils.defaultAbiCoder.encode(["uint", "uint8", "uint16"], [5, 6, 0])
            ).should.be.eventually.rejected;
        });

        it("should fail when schain name is Mainnet", async () => {
            const price = await schains.getSchainPrice(1, 5);
            await schains.addSchain(
                holder.address,
                price.toString(),
                ethers.utils.defaultAbiCoder.encode(
                    [schainParametersType],
                    [{
                        lifetime: 5,
                        typeOfSchain: SchainType.SMALL,
                        nonce: 0,
                        name: "Mainnet", // wrong name
                        originator: ethers.constants.AddressZero,
                        options: []
                    }]
                )
            ).should.be.eventually.rejectedWith("Schain name is not available");
        });

        it("should fail when schain name is None", async () => {
            const price = await schains.getSchainPrice(1, 5);
            await schains.addSchain(
                holder.address,
                price.toString(),
                ethers.utils.defaultAbiCoder.encode(
                    [schainParametersType],
                    [{
                        lifetime: 5,
                        typeOfSchain: SchainType.SMALL,
                        nonce: 0,
                        name: "", // wrong name
                        originator: ethers.constants.AddressZero,
                        options: []
                    }]
                )
            ).should.be.eventually.rejectedWith("Schain name is not available");
        });

        it("should fail when nodes count is too low", async () => {
            const price = await schains.getSchainPrice(1, 5);
            await schains.addSchain(
                holder.address,
                price.toString(),
                ethers.utils.defaultAbiCoder.encode(
                    [schainParametersType],
                    [{
                        lifetime: 5,
                        typeOfSchain: SchainType.SMALL,
                        nonce: 0,
                        name: "d2",
                        originator: ethers.constants.AddressZero,
                        options: []
                    }]
                )
            ).should.be.eventually.rejectedWith("Not enough nodes to create Schain");
        });

        describe("when 2 nodes are registered (Ivan test)", () => {
            it("should create 2 nodes, and play with schains", async () => {
                const nodesCount = 2;
                for (const index of Array.from(Array(nodesCount).keys())) {
                    const hexIndex = ("0" + index.toString(16)).slice(-2);
                    await skaleManager.connect(nodeAddress1).createNode(
                        8545, // port
                        0, // nonce
                        "0x7f0000" + hexIndex, // ip
                        "0x7f0000" + hexIndex, // public ip
                        getPublicKey(nodeAddress1), // public key
                        "D2-" + hexIndex, // name
                        "some.domain.name");
                }

                const deposit = await schains.getSchainPrice(4, 5);

                await schains.addSchain(
                    owner.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.TEST,
                            nonce: 0,
                            name: "d2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                );

                await schains.addSchain(
                    owner.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.TEST,
                            nonce: 0,
                            name: "d3",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                );

                await schains.deleteSchain(
                    owner.address,
                    "d2");

                await schains.deleteSchain(
                    owner.address,
                    "d3");
                await schainsInternal.getActiveSchains(0).should.be.eventually.empty;
                await schainsInternal.getActiveSchains(1).should.be.eventually.empty;

                await nodes.initExit(0);
                await nodes.completeExit(0);
                await nodes.initExit(1);
                await nodes.completeExit(1);

                for (const index of Array.from(Array(nodesCount).keys())) {
                    const hexIndex = ("1" + index.toString(16)).slice(-2);
                    await skaleManager.connect(nodeAddress1).createNode(
                        8545, // port
                        0, // nonce
                        "0x7f0000" + hexIndex, // ip
                        "0x7f0000" + hexIndex, // public ip
                        getPublicKey(nodeAddress1), // public key
                        "D2-" + hexIndex, // name
                        "some.domain.name");
                }

                await schains.addSchain(
                    holder.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.TEST,
                            nonce: 0,
                            name: "d4",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                );
            });
        });

        describe("when 2 nodes are registered (Node rotation test)", () => {
            it("should create 2 nodes, and play with schains", async () => {
                const nodesCount = 2;
                for (const index of Array.from(Array(nodesCount).keys())) {
                    const hexIndex = ("0" + index.toString(16)).slice(-2);
                    await skaleManager.connect(nodeAddress1).createNode(
                        8545, // port
                        0, // nonce
                        "0x7f0000" + hexIndex, // ip
                        "0x7f0000" + hexIndex, // public ip
                        getPublicKey(nodeAddress1), // public key
                        "D2-" + hexIndex, // name
                        "some.domain.name");
                }

                const deposit = await schains.getSchainPrice(4, 5);

                const verificationVector = [{
                    x: {
                        a: "0x02c2b888a23187f22195eadadbc05847a00dc59c913d465dbc4dfac9cfab437d",
                        b: "0x2695832627b9081e77da7a3fc4d574363bf051700055822f3d394dc3d9ff7417",
                    },
                    y: {
                        a: "0x24727c45f9322be756fbec6514525cbbfa27ef1951d3fed10f483c23f921879d",
                        b: "0x03a7a3e6f3b539dad43c0eca46e3f889b2b2300815ffc4633e26e64406625a99"
                    }
                }];

                const encryptedSecretKeyContribution: {share: string, publicKey: [string, string]}[] = [
                    {
                        share: "0x937c9c846a6fa7fd1984fe82e739ae37fcaa555c1dc0e8597c9f81b6a12f232f",
                        publicKey: [
                            "0xfdf8101e91bd658fa1cea6fdd75adb8542951ce3d251cdaa78f43493dad730b5",
                            "0x9d32d2e872b36aa70cdce544b550ebe96994de860b6f6ebb7d0b4d4e6724b4bf"
                        ]
                    },
                    {
                        share: "0x7232f27fdfe521f3c7997dbb1c15452b7f196bd119d915ce76af3d1a008e1810",
                        publicKey: [
                            "0x086ff076abe442563ae9b8938d483ae581f4de2ee54298b3078289bbd85250c8",
                            "0xdf956450d32f671e4a8ec1e584119753ff171e80a61465246bfd291e8dac3d77"
                        ]
                    }
                ];

                await schains.addSchain(
                    owner.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.TEST,
                            nonce: 0,
                            name: "d2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                );
                let res1 = await schainsInternal.getNodesInGroup(stringKeccak256("d2"));
                let res = await skaleDKG.connect(nodeAddress1).isBroadcastPossible(stringKeccak256("d2"), res1[0]);
                assert.equal(res, true);
                await wallets.connect(owner).rechargeSchainWallet(stringKeccak256("d2"), {value: 1e20.toString()});
                await skaleDKG.connect(nodeAddress1).broadcast(
                    stringKeccak256("d2"),
                    res1[0],
                    verificationVector,
                    // the last symbol is spoiled in parameter below
                    encryptedSecretKeyContribution
                );
                res = await skaleDKG.connect(nodeAddress1).isBroadcastPossible(stringKeccak256("d2"), res1[1]);
                assert.equal(res, true);
                await skaleDKG.connect(nodeAddress1).broadcast(
                    stringKeccak256("d2"),
                    res1[1],
                    verificationVector,
                    // the last symbol is spoiled in parameter below
                    encryptedSecretKeyContribution
                );

                let resO = await skaleDKG.isChannelOpened(stringKeccak256("d2"));
                assert.equal(resO, true);

                res = await skaleDKG.connect(nodeAddress1).isAlrightPossible(stringKeccak256("d2"), res1[0]);
                assert.equal(res, true);

                await skaleDKG.connect(nodeAddress1).alright(
                    stringKeccak256("d2"),
                    res1[0]
                );

                resO = await skaleDKG.isChannelOpened(stringKeccak256("d2"));
                assert.equal(resO, true);

                res = await skaleDKG.connect(nodeAddress1).isAlrightPossible(stringKeccak256("d2"), res1[1]);
                assert.equal(res, true);

                await skaleDKG.connect(nodeAddress1).alright(
                    stringKeccak256("d2"),
                    res1[1]
                );

                await skaleManager.connect(nodeAddress1).createNode(
                    8545, // port
                    0, // nonce
                    "0x7f000011", // ip
                    "0x7f000011", // public ip
                    getPublicKey(nodeAddress1), // public key
                    "D2-11", // name
                    "some.domain.name");

                resO = await skaleDKG.isChannelOpened(stringKeccak256("d2"));
                assert.equal(resO, false);

                await nodes.initExit(0);
                await skaleManager.connect(nodeAddress1).nodeExit(0);
                res1 = await schainsInternal.getNodesInGroup(stringKeccak256("d2"));
                const nodeRot = res1[1];
                res = await skaleDKG.connect(nodeAddress1).isBroadcastPossible(stringKeccak256("d2"), nodeRot);
                assert.equal(res, true);
                res = await skaleDKG.connect(nodeAddress1).isBroadcastPossible(stringKeccak256("d2"), res1[0]);
                assert.equal(res, true);
                await skaleDKG.connect(nodeAddress1).broadcast(
                    stringKeccak256("d2"),
                    res1[0],
                    verificationVector,
                    // the last symbol is spoiled in parameter below
                    encryptedSecretKeyContribution
                );
                res = await skaleDKG.connect(nodeAddress1).isBroadcastPossible(stringKeccak256("d2"), res1[1]);
                assert.equal(res, true);
                await skaleDKG.connect(nodeAddress1).broadcast(
                    stringKeccak256("d2"),
                    res1[1],
                    verificationVector,
                    // the last symbol is spoiled in parameter below
                    encryptedSecretKeyContribution
                );

                resO = await skaleDKG.isChannelOpened(stringKeccak256("d2"));
                assert.equal(resO, true);

                res = await skaleDKG.connect(nodeAddress1).isAlrightPossible(
                    stringKeccak256("d2"),
                    res1[0]
                );
                assert.equal(res, true);

                await skaleDKG.connect(nodeAddress1).alright(
                    stringKeccak256("d2"),
                    res1[0]
                );

                resO = await skaleDKG.isChannelOpened(stringKeccak256("d2"));
                assert.equal(resO, true);

                res = await skaleDKG.connect(nodeAddress1).isAlrightPossible(
                    stringKeccak256("d2"),
                    res1[1]
                );
                assert.equal(res, true);

                await skaleDKG.connect(nodeAddress1).alright(
                    stringKeccak256("d2"),
                    res1[1]
                );
            });

            it("should get previous nodes after nodeExit",  async () => {
                const nodesCount = 2;
                for (const index of Array.from(Array(nodesCount).keys())) {
                    const hexIndex = ("0" + index.toString(16)).slice(-2);
                    await skaleManager.connect(nodeAddress1).createNode(
                        8545, // port
                        0, // nonce
                        "0x7f0000" + hexIndex, // ip
                        "0x7f0000" + hexIndex, // public ip
                        getPublicKey(nodeAddress1), // public key
                        "D2-" + hexIndex, // name
                        "some.domain.name");
                }

                const schainName = "d2";
                const schainHash = ethers.utils.solidityKeccak256(["string"], [schainName]);
                await schains.grantRole(await schains.SCHAIN_CREATOR_ROLE(), owner.address);
                await schains.addSchainByFoundation(5, SchainType.TEST, 0, schainName, schains.address, owner.address, []);
                await skaleDKG.setSuccessfulDKGPublic(schainHash);

                await skaleManager.connect(nodeAddress1).createNode(
                    8545, // port
                    0, // nonce
                    "0x7f000011", // ip
                    "0x7f000011", // public ip
                    getPublicKey(nodeAddress1), // public key
                    "D2-11", // name
                    "some.domain.name"
                );

                await nodes.initExit(0);
                await skaleManager.connect(nodeAddress1).nodeExit(0);

                await skaleDKG.setSuccessfulDKGPublic(schainHash);


                (await nodeRotation.getPreviousNode(schainHash, 2)).should.be.equal(0);
                await nodeRotation.getPreviousNode(schainHash, 1).should.be.eventually.rejectedWith("No previous node");
                await nodeRotation.getPreviousNode(schainHash, 0).should.be.eventually.rejectedWith("No previous node");
                await nodeRotation.getPreviousNode(schainHash, 3).should.be.eventually.rejectedWith("No previous node");

                await skaleManager.connect(nodeAddress1).createNode(
                    8545, // port
                    0, // nonce
                    "0x7f000012", // ip
                    "0x7f000012", // public ip
                    getPublicKey(nodeAddress1), // public key
                    "D2-12", // name
                    "some.domain.name"
                );

                await skipTime(43260);
                await nodes.initExit(2);
                await skaleManager.connect(nodeAddress1).nodeExit(2);

                await skaleDKG.setSuccessfulDKGPublic(schainHash);

                (await nodeRotation.getPreviousNode(schainHash, 3)).should.be.equal(2);
                (await nodeRotation.getPreviousNode(schainHash, 2)).should.be.equal(0);
                await nodeRotation.getPreviousNode(schainHash, 1).should.be.eventually.rejectedWith("No previous node");
                await nodeRotation.getPreviousNode(schainHash, 0).should.be.eventually.rejectedWith("No previous node");
                await nodeRotation.getPreviousNode(schainHash, 4).should.be.eventually.rejectedWith("No previous node");

                await skaleManager.connect(nodeAddress1).createNode(
                    8545, // port
                    0, // nonce
                    "0x7f000013", // ip
                    "0x7f000013", // public ip
                    getPublicKey(nodeAddress1), // public key
                    "D2-13", // name
                    "some.domain.name"
                );

                await skipTime(43260);
                await nodes.initExit(1);
                await skaleManager.connect(nodeAddress1).nodeExit(1);

                await skaleDKG.setSuccessfulDKGPublic(schainHash);

                (await nodeRotation.getPreviousNode(schainHash, 4)).should.be.equal(1);
                (await nodeRotation.getPreviousNode(schainHash, 3)).should.be.equal(2);
                (await nodeRotation.getPreviousNode(schainHash, 2)).should.be.equal(0);
                await nodeRotation.getPreviousNode(schainHash, 1).should.be.eventually.rejectedWith("No previous node");
                await nodeRotation.getPreviousNode(schainHash, 0).should.be.eventually.rejectedWith("No previous node");
                await nodeRotation.getPreviousNode(schainHash, 5).should.be.eventually.rejectedWith("No previous node");

            });

            it("should get previous nodes after DKG failure",  async () => {
                const nodesCount = 2;
                for (const index of Array.from(Array(nodesCount).keys())) {
                    const hexIndex = ("0" + index.toString(16)).slice(-2);
                    await skaleManager.connect(nodeAddress1).createNode(
                        8545, // port
                        0, // nonce
                        "0x7f0000" + hexIndex, // ip
                        "0x7f0000" + hexIndex, // public ip
                        getPublicKey(nodeAddress1), // public key
                        "D2-" + hexIndex, // name
                        "some.domain.name");
                }

                const schainName = "d2";
                const schainHash = ethers.utils.solidityKeccak256(["string"], [schainName]);
                await schains.grantRole(await schains.SCHAIN_CREATOR_ROLE(), owner.address);
                await schains.addSchainByFoundation(5, SchainType.TEST, 0, schainName, schains.address, owner.address, []);
                await wallets.connect(owner).rechargeSchainWallet(stringKeccak256("d2"), {value: 1e20.toString()});

                const verificationVector = [{
                    x: {
                        a: "0x02c2b888a23187f22195eadadbc05847a00dc59c913d465dbc4dfac9cfab437d",
                        b: "0x2695832627b9081e77da7a3fc4d574363bf051700055822f3d394dc3d9ff7417",
                    },
                    y: {
                        a: "0x24727c45f9322be756fbec6514525cbbfa27ef1951d3fed10f483c23f921879d",
                        b: "0x03a7a3e6f3b539dad43c0eca46e3f889b2b2300815ffc4633e26e64406625a99"
                    }
                }];

                const encryptedSecretKeyContribution: {share: string, publicKey: [string, string]}[] = [
                    {
                        share: "0x937c9c846a6fa7fd1984fe82e739ae37fcaa555c1dc0e8597c9f81b6a12f232f",
                        publicKey: [
                            "0xfdf8101e91bd658fa1cea6fdd75adb8542951ce3d251cdaa78f43493dad730b5",
                            "0x9d32d2e872b36aa70cdce544b550ebe96994de860b6f6ebb7d0b4d4e6724b4bf"
                        ]
                    },
                    {
                        share: "0x7232f27fdfe521f3c7997dbb1c15452b7f196bd119d915ce76af3d1a008e1810",
                        publicKey: [
                            "0x086ff076abe442563ae9b8938d483ae581f4de2ee54298b3078289bbd85250c8",
                            "0xdf956450d32f671e4a8ec1e584119753ff171e80a61465246bfd291e8dac3d77"
                        ]
                    }
                ];

                await skaleDKG.connect(nodeAddress1).broadcast(
                    schainHash,
                    0,
                    verificationVector,
                    // the last symbol is spoiled in parameter below
                    encryptedSecretKeyContribution
                );

                await skaleDKG.connect(nodeAddress1).broadcast(
                    schainHash,
                    1,
                    verificationVector,
                    // the last symbol is spoiled in parameter below
                    encryptedSecretKeyContribution
                );

                await skaleDKG.connect(nodeAddress1).alright(
                    schainHash,
                    1
                );

                await skaleManager.connect(nodeAddress1).createNode(
                    8545, // port
                    0, // nonce
                    "0x7f000011", // ip
                    "0x7f000011", // public ip
                    getPublicKey(nodeAddress1), // public key
                    "D2-11", // name
                    "some.domain.name"
                );

                await skipTime(1800);
                await skaleDKG.connect(nodeAddress1).complaint(
                    schainHash,
                    1,
                    0
                );

                (await nodeRotation.getPreviousNode(schainHash, 2)).should.be.equal(0);
                await nodeRotation.getPreviousNode(schainHash, 1).should.be.eventually.rejectedWith("No previous node");
                await nodeRotation.getPreviousNode(schainHash, 0).should.be.eventually.rejectedWith("No previous node");
                await nodeRotation.getPreviousNode(schainHash, 3).should.be.eventually.rejectedWith("No previous node");

                await skaleDKG.connect(nodeAddress1).broadcast(
                    schainHash,
                    2,
                    verificationVector,
                    // the last symbol is spoiled in parameter below
                    encryptedSecretKeyContribution
                );

                await skaleDKG.connect(nodeAddress1).broadcast(
                    schainHash,
                    1,
                    verificationVector,
                    // the last symbol is spoiled in parameter below
                    encryptedSecretKeyContribution
                );

                await skaleDKG.connect(nodeAddress1).alright(
                    schainHash,
                    1
                );

                await skaleManager.connect(nodeAddress1).createNode(
                    8545, // port
                    0, // nonce
                    "0x7f000012", // ip
                    "0x7f000012", // public ip
                    getPublicKey(nodeAddress1), // public key
                    "D2-12", // name
                    "some.domain.name"
                );

                await skipTime(1800);
                await skaleDKG.connect(nodeAddress1).complaint(
                    schainHash,
                    1,
                    2
                );

                (await nodeRotation.getPreviousNode(schainHash, 3)).should.be.equal(2);
                (await nodeRotation.getPreviousNode(schainHash, 2)).should.be.equal(0);
                await nodeRotation.getPreviousNode(schainHash, 1).should.be.eventually.rejectedWith("No previous node");
                await nodeRotation.getPreviousNode(schainHash, 0).should.be.eventually.rejectedWith("No previous node");
                await nodeRotation.getPreviousNode(schainHash, 4).should.be.eventually.rejectedWith("No previous node");

                await skaleDKG.connect(nodeAddress1).broadcast(
                    schainHash,
                    3,
                    verificationVector,
                    // the last symbol is spoiled in parameter below
                    encryptedSecretKeyContribution
                );

                await skaleDKG.connect(nodeAddress1).broadcast(
                    schainHash,
                    1,
                    verificationVector,
                    // the last symbol is spoiled in parameter below
                    encryptedSecretKeyContribution
                );

                await skaleDKG.connect(nodeAddress1).alright(
                    schainHash,
                    3
                );

                await skaleManager.connect(nodeAddress1).createNode(
                    8545, // port
                    0, // nonce
                    "0x7f000013", // ip
                    "0x7f000013", // public ip
                    getPublicKey(nodeAddress1), // public key
                    "D2-13", // name
                    "some.domain.name"
                );

                await skipTime(1800);
                await skaleDKG.connect(nodeAddress1).complaint(
                    schainHash,
                    3,
                    1
                );

                (await nodeRotation.getPreviousNode(schainHash, 4)).should.be.equal(1);
                (await nodeRotation.getPreviousNode(schainHash, 3)).should.be.equal(2);
                (await nodeRotation.getPreviousNode(schainHash, 2)).should.be.equal(0);
                await nodeRotation.getPreviousNode(schainHash, 1).should.be.eventually.rejectedWith("No previous node");
                await nodeRotation.getPreviousNode(schainHash, 0).should.be.eventually.rejectedWith("No previous node");
                await nodeRotation.getPreviousNode(schainHash, 5).should.be.eventually.rejectedWith("No previous node");

            });
        });

        describe("when 4 nodes are registered", () => {
            fastBeforeEach(async () => {
                const nodesCount = 4;
                for (const index of Array.from(Array(nodesCount).keys())) {
                    const hexIndex = ("0" + index.toString(16)).slice(-2);
                    await skaleManager.connect(nodeAddress1).createNode(
                        8545, // port
                        0, // nonce
                        "0x7f0000" + hexIndex, // ip
                        "0x7f0000" + hexIndex, // public ip
                        getPublicKey(nodeAddress1), // public key
                        "D2-" + hexIndex, // name
                        "some.domain.name");
                }
            });

            it("should create 4 node schain", async () => {
                const deposit = await schains.getSchainPrice(5, 5);

                await schains.addSchain(
                    holder.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                );

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainHash = sChains[0];

                await schainsInternal.isOwnerAddress(holder.address, schainHash).should.be.eventually.true;
            });

            it("should not create 4 node schain with 1 deleted node", async () => {
                await nodes.initExit(1);
                await nodes.completeExit(1);

                const deposit = await schains.getSchainPrice(5, 5);

                await schains.addSchain(
                    holder.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                ).should.be.eventually.rejectedWith("Not enough nodes to create Schain");
            });

            it("should not create 4 node schain with 1 In Maintenance node", async () => {
                await nodes.setNodeInMaintenance(2);

                const deposit = await schains.getSchainPrice(5, 5);

                await schains.addSchain(
                    holder.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                ).should.be.eventually.rejectedWith("Not enough nodes to create Schain");
            });

            it("should not create 4 node schain with 1 incompliant node", async () => {
                await nodes.grantRole(await nodes.COMPLIANCE_ROLE(), owner.address);
                await nodes.setNodeIncompliant(2);

                await nodes.setNodeInMaintenance(2);
                await nodes.removeNodeFromInMaintenance(2);

                const deposit = await schains.getSchainPrice(5, 5);

                await schains.addSchain(
                    holder.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                ).should.be.eventually.rejectedWith("Not enough nodes to create Schain");
            });

            it("should create 4 node schain with 1 From In Maintenance node", async () => {
                await nodes.setNodeInMaintenance(2);

                const deposit = await schains.getSchainPrice(5, 5);

                await schains.addSchain(
                    holder.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                ).should.be.eventually.rejectedWith("Not enough nodes to create Schain");

                await nodes.removeNodeFromInMaintenance(2);

                await schains.addSchain(
                    holder.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                );

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainHash = sChains[0];

                await schainsInternal.isOwnerAddress(holder.address, schainHash).should.be.eventually.true;
            });

            it("should not create 4 node schain on deleted node", async () => {
                const removedNode = 1;
                await nodes.initExit(removedNode);
                await nodes.completeExit(removedNode);

                await skaleManager.connect(nodeAddress1).createNode(
                    8545, // port
                    0, // nonce
                    "0x7f000028", // ip
                    "0x7f000028", // public ip
                    getPublicKey(nodeAddress1), // public key
                    "D2-28", // name
                    "some.domain.name");

                const deposit = await schains.getSchainPrice(5, 5);

                await schains.addSchain(
                    holder.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                );

                let nodesInGroup = await schainsInternal.getNodesInGroup(stringKeccak256("d2"));

                for (const node of nodesInGroup) {
                    node.should.be.not.equal(removedNode);
                }

                await schains.addSchain(
                    holder.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d3",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                );

                nodesInGroup = await schainsInternal.getNodesInGroup(stringKeccak256("d3"));

                for (const node of nodesInGroup) {
                    node.should.be.not.equal(removedNode);
                }

                await schains.addSchain(
                    holder.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d4",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                );

                nodesInGroup = await schainsInternal.getNodesInGroup(stringKeccak256("d4"));

                for (const node of nodesInGroup) {
                    node.should.be.not.equal(removedNode);
                }

                await schains.addSchain(
                    holder.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d5",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                );

                nodesInGroup = await schainsInternal.getNodesInGroup(stringKeccak256("d5"));

                for (const node of nodesInGroup) {
                    node.should.be.not.equal(removedNode);
                }
            });

            it("should create & delete 4 node schain", async () => {
                const deposit = await schains.getSchainPrice(5, 5);

                await schains.addSchain(
                    holder.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d2",
                            originator: ethers.constants.AddressZero,
                            options: [
                                {
                                    name: "one",
                                    value: "0x01"
                                },
                                {
                                    name: "two",
                                    value: "0x02"
                                }
                            ]
                        }]
                    )
                );

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainHash = sChains[0];

                await schainsInternal.isOwnerAddress(holder.address, schainHash).should.be.eventually.true;

                await schains.getOption(schainHash, "one")
                    .should.be.eventually.equal("0x01");

                const options = await schains.getOptions(schainHash);
                options.length.should.be.equal(2);
                options[0].name.should.be.equal("one");
                options[0].value.should.be.equal("0x01");
                options[1].name.should.be.equal("two");
                options[1].value.should.be.equal("0x02");

                await schains.deleteSchain(
                    holder.address,
                    "d2",
                );

                await schainsInternal.getSchains().should.be.eventually.empty;
                await schains.getOption(schainHash, "one")
                    .should.be.eventually.rejectedWith("The schain does not exist");
            });

            it("should allow the foundation to create schain without tokens", async () => {
                const schainCreator = holder;
                await schains.grantRole(await schains.SCHAIN_CREATOR_ROLE(), schainCreator.address);
                await schains.connect(schainCreator).addSchainByFoundation(5, SchainType.MEDIUM_TEST, 0, "d2", ethers.constants.AddressZero, ethers.constants.AddressZero, []);

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainHash = sChains[0];

                await schainsInternal.isOwnerAddress(schainCreator.address, schainHash).should.be.eventually.true;
            });

            it("should allow to delete schain if schain owner is a multisig wallet", async () => {
                const schainName = "d2";
                const amountInWei = 100;
                const fallbackGasUsage = 1e5;
                const schainHash = stringKeccak256(schainName);
                const fallbackMock = await (await ethers.getContractFactory("FallbackMock")).deploy(fallbackGasUsage);
                await schains.grantRole(await schains.SCHAIN_CREATOR_ROLE(), holder.address);
                await skaleManager.grantRole(await skaleManager.SCHAIN_REMOVAL_ROLE(), holder.address);
                await schains.connect(holder).addSchainByFoundation(5, SchainType.MEDIUM_TEST, 0, schainName, fallbackMock.address, holder.address, []);
                await wallets.rechargeSchainWallet(schainHash, {value: amountInWei})
                await ethers.provider.getBalance(fallbackMock.address).should.be.eventually.equal(0);
                await skaleManager.connect(holder).deleteSchainByRoot(schainName);
                await ethers.provider.getBalance(fallbackMock.address).should.be.eventually.equal(amountInWei);
            });

            it("should assign schain creator on different address", async () => {
                await schains.grantRole(await schains.SCHAIN_CREATOR_ROLE(), owner.address);
                await schains.addSchainByFoundation(5, SchainType.MEDIUM_TEST, 0, "d2", holder.address, ethers.constants.AddressZero, []);

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainHash = sChains[0];

                await schainsInternal.isOwnerAddress(holder.address, schainHash).should.be.eventually.true;
            });

            it("should store originator address if schain owner is a smart contract", async () => {
                const schainName = "d2";
                const schainHash = ethers.utils.solidityKeccak256(["string"], [schainName]);
                await schains.grantRole(await schains.SCHAIN_CREATOR_ROLE(), owner.address);
                await schains.addSchainByFoundation(5, SchainType.MEDIUM_TEST, 0, schainName, schains.address, owner.address, []);
                await schainsInternal.getSchainOriginator(schainHash).should.be.eventually.equal(owner.address);
            });

            it("should not store originator address if schain owner is not a smart contract", async () => {
                const schainName = "d2";
                const schainHash = ethers.utils.solidityKeccak256(["string"], [schainName]);
                await schains.grantRole(await schains.SCHAIN_CREATOR_ROLE(), owner.address);
                await schains.addSchainByFoundation(5, SchainType.MEDIUM_TEST, 0, schainName, owner.address, owner.address, []);
                await schainsInternal.getSchainOriginator(schainHash)
                    .should.be.rejectedWith("Originator address is not set");
            });
        });

        describe("when 20 nodes are registered", () => {
            fastBeforeEach(async () => {
                const nodesCount = 20;
                for (const index of Array.from(Array(nodesCount).keys())) {
                    const hexIndex = ("0" + index.toString(16)).slice(-2);
                    await skaleManager.connect(nodeAddress1).createNode(
                        8545, // port
                        0, // nonce
                        "0x7f0000" + hexIndex, // ip
                        "0x7f0000" + hexIndex, // public ip
                        getPublicKey(nodeAddress1), // public key
                        "D2-" + hexIndex, // name
                        "some.domain.name");
                }
            });

            it("should create Medium schain", async () => {
                const deposit = await schains.getSchainPrice(3, 5);

                await schains.addSchain(
                    holder.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.LARGE,
                            nonce: 0,
                            name: "d2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                );

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
            });

            it("should not create another Medium schain", async () => {
                const deposit = await schains.getSchainPrice(3, 5);

                await schains.addSchain(
                    holder.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.LARGE,
                            nonce: 0,
                            name: "d2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                );

                await schains.addSchain(
                    holder.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.LARGE,
                            nonce: 0,
                            name: "d3",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                ).should.be.eventually.rejectedWith("Not enough nodes to create Schain");
            });

            it("should assign schain creator on different address and create small schain", async () => {
                await schains.grantRole(await schains.SCHAIN_CREATOR_ROLE(), holder.address);
                await schains.connect(holder).addSchainByFoundation(5, SchainType.SMALL, 0, "d2", ethers.constants.AddressZero, ethers.constants.AddressZero, []);

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainHash = sChains[0];

                await schainsInternal.isOwnerAddress(holder.address, schainHash).should.be.eventually.true;
            });

            it("should assign schain creator on different address and create medium schain", async () => {
                await schains.grantRole(await schains.SCHAIN_CREATOR_ROLE(), holder.address);
                await schains.connect(holder).addSchainByFoundation(5, SchainType.MEDIUM, 0, "d2", ethers.constants.AddressZero, ethers.constants.AddressZero, []);

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainHash = sChains[0];

                await schainsInternal.isOwnerAddress(holder.address, schainHash).should.be.eventually.true;
            });

            it("should assign schain creator on different address and create large schain", async () => {
                await schains.grantRole(await schains.SCHAIN_CREATOR_ROLE(), holder.address);
                await schains.connect(holder).addSchainByFoundation(5, SchainType.LARGE, 0, "d2", ethers.constants.AddressZero, ethers.constants.AddressZero, []);

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainHash = sChains[0];

                await schainsInternal.isOwnerAddress(holder.address, schainHash).should.be.eventually.true;
            });
        });

        describe("when nodes are registered correctly", () => {
            fastBeforeEach(async () => {
                const nodesCount = 4;
                const nodeAddresses = [
                    nodeAddress1,
                    nodeAddress2,
                    nodeAddress3,
                    nodeAddress4
                ];
                for (const index of Array.from(Array(nodesCount).keys())) {
                    const hexIndex = ("0" + index.toString(16)).slice(-2);
                    await skaleManager.connect(nodeAddresses[index]).createNode(
                        8545, // port
                        0, // nonce
                        "0x7f0000" + hexIndex, // ip
                        "0x7f0000" + hexIndex, // public ip
                        getPublicKey(nodeAddresses[index]), // public key
                        "D2-" + hexIndex, // name
                        "some.domain.name");
                }
                await contractManager.setContractsAddress("SchainsInternal", schainsInternal2.address);
            });

            it("should check node addresses after schain creation", async () => {
                const deposit = await schains.getSchainPrice(5, 5);
                await schains.addSchain(
                    holder.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "D2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                );
                expect(await schainsInternal2.isNodeAddressesInGroup(stringKeccak256("D2"), nodeAddress1.address)).be.true;
                expect(await schainsInternal2.isNodeAddressesInGroup(stringKeccak256("D2"), nodeAddress2.address)).be.true;
                expect(await schainsInternal2.isNodeAddressesInGroup(stringKeccak256("D2"), nodeAddress3.address)).be.true;
                expect(await schainsInternal2.isNodeAddressesInGroup(stringKeccak256("D2"), nodeAddress4.address)).be.true;
                expect(await schainsInternal2.isNodeAddressesInGroup(stringKeccak256("D2"), owner.address)).be.false;
                expect(await schainsInternal2.isNodeAddressesInGroup(stringKeccak256("D2"), holder.address)).be.false;
            });

            it("should not add the same address", async () => {
                const deposit = await schains.getSchainPrice(5, 5);
                await schains.addSchain(
                    holder.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "D2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                );
                expect(await schainsInternal2.isNodeAddressesInGroup(stringKeccak256("D2"), nodeAddress1.address)).be.true;
                expect(await schainsInternal2.isNodeAddressesInGroup(stringKeccak256("D2"), nodeAddress2.address)).be.true;
                expect(await schainsInternal2.isNodeAddressesInGroup(stringKeccak256("D2"), nodeAddress3.address)).be.true;
                expect(await schainsInternal2.isNodeAddressesInGroup(stringKeccak256("D2"), nodeAddress4.address)).be.true;
                expect(await schainsInternal2.isNodeAddressesInGroup(stringKeccak256("D2"), owner.address)).be.false;
                expect(await schainsInternal2.isNodeAddressesInGroup(stringKeccak256("D2"), holder.address)).be.false;
                await skaleManager.connect(nodeAddress1).createNode(
                    8545, // port
                    0, // nonce
                    "0x7f0000ff", // ip
                    "0x7f0000ff", // public ip
                    getPublicKey(nodeAddress1), // public key
                    "D2-ff", // name
                    "some.domain.name"
                );
                await skaleDKG.setSuccessfulDKGPublic(
                    stringKeccak256("D2"),
                );
                await nodes.initExit(1);
                await skaleManager.connect(nodeAddress2).nodeExit(1).should.be.eventually.rejectedWith("Node address already exist");
            });
        });

        describe("when nodes are registered", () => {
            fastBeforeEach(async () => {
                const nodesCount = 16;
                for (const index of Array.from(Array(nodesCount).keys())) {
                    const hexIndex = ("0" + index.toString(16)).slice(-2);
                    await skaleManager.connect(nodeAddress1).createNode(
                        8545, // port
                        0, // nonce
                        "0x7f0000" + hexIndex, // ip
                        "0x7f0000" + hexIndex, // public ip
                        getPublicKey(nodeAddress1), // public key
                        "D2-" + hexIndex, // name
                        "some.domain.name");
                }
            });

            it("successfully create 1 type Of Schain", async () => {
                const deposit = await schains.getSchainPrice(1, 5);

                await schains.addSchain(
                    holder.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.SMALL,
                            nonce: 0,
                            name: "d2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                );

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainHash = sChains[0];

                await schainsInternal.isOwnerAddress(holder.address, schainHash).should.be.eventually.true;

                const obtainedSchain = await schainsInternal.schains(schainHash);

                obtainedSchain.name.should.be.equal("d2");
                obtainedSchain.owner.should.be.equal(holder.address);
                obtainedSchain.partOfNode.should.be.equal(1);
                obtainedSchain.lifetime.should.be.equal(5);
                obtainedSchain.deposit.should.be.equal(deposit);
            });

            it("should add new type of Schain and create Schain", async () => {
                await schainsInternal.addSchainType(8, 16);
                const deposit = await schains.getSchainPrice(6, 5);

                await schains.addSchain(
                    holder.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: 6,
                            nonce: 0,
                            name: "d2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                );

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainHash = sChains[0];

                await schainsInternal.isOwnerAddress(holder.address, schainHash).should.be.eventually.true;

                const obtainedSchain = await schainsInternal.schains(schainHash);

                obtainedSchain.name.should.be.equal("d2");
                obtainedSchain.owner.should.be.equal(holder.address);
                obtainedSchain.partOfNode.should.be.equal(8);
                obtainedSchain.lifetime.should.be.equal(5);
                obtainedSchain.deposit.should.be.equal(deposit);
            });

            it("should add another new type of Schain and create Schain", async () => {
                await schainsInternal.addSchainType(32, 16);
                const deposit = await schains.getSchainPrice(6, 5);

                await schains.addSchain(
                    holder.address,
                    deposit,
                    ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: 6,
                            nonce: 0,
                            name: "d2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                );

                const sChains = await schainsInternal.getSchains();
                sChains.length.should.be.equal(1);
                const schainHash = sChains[0];

                await schainsInternal.isOwnerAddress(holder.address, schainHash).should.be.eventually.true;

                const obtainedSchain = await schainsInternal.schains(schainHash);

                obtainedSchain.name.should.be.equal("d2");
                obtainedSchain.owner.should.be.equal(holder.address);
                obtainedSchain.partOfNode.should.be.equal(32);
                obtainedSchain.lifetime.should.be.equal(5);
                obtainedSchain.deposit.should.be.equal(deposit);
            });

            describe("when schain is created", () => {
                fastBeforeEach(async () => {
                    const deposit = await schains.getSchainPrice(1, 5);
                    await schains.addSchain(
                        holder.address,
                        deposit,
                        ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.SMALL,
                            nonce: 0,
                            name: "D2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                    );
                });

                it("should failed when create another schain with the same name", async () => {
                    const deposit = await schains.getSchainPrice(1, 5);
                    await schains.addSchain(
                        holder.address,
                        deposit,
                        ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.SMALL,
                            nonce: 0,
                            name: "D2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
                    ).should.be.eventually.rejectedWith("Schain name is not available");
                });

                it("should be able to delete schain", async () => {
                    await schains.deleteSchain(
                        holder.address,
                        "D2",
                    );
                    await schainsInternal.getSchains().should.be.eventually.empty;
                });

                it("should check group", async () => {
                    const res = await schainsInternal.getNodesInGroup(stringKeccak256("D2"));
                    res.length.should.be.equal(16);
                });

                it("should delete group", async () => {
                    await schainsInternal.deleteGroup(stringKeccak256("D2"));
                    const res = await schainsInternal.getNodesInGroup(stringKeccak256("D2"));
                    res.length.should.be.equal(0);
                    await schainsInternal.getNodesInGroup(stringKeccak256("D2")).should.be.eventually.empty;
                });

                it("should fail on deleting schain if owner is wrong", async () => {
                    await schains.deleteSchain(
                        nodeAddress1.address,
                        "D2",
                    ).should.be.eventually.rejectedWith("Message sender is not the owner of the Schain");
                });

            });

            describe("when test schain is created", () => {

                fastBeforeEach(async () => {
                    const deposit = await schains.getSchainPrice(4, 5);
                    await schains.addSchain(
                        holder.address,
                        deposit,
                        ethers.utils.defaultAbiCoder.encode(
                            [schainParametersType],
                            [{
                                lifetime: 5,
                                typeOfSchain: SchainType.TEST,
                                nonce: 0,
                                name: "D2",
                                originator: ethers.constants.AddressZero,
                                options: []
                            }]
                        )
                    );
                });

                it("should failed when create another schain with the same name", async () => {
                    const deposit = await schains.getSchainPrice(4, 5);
                    await schains.addSchain(
                        holder.address,
                        deposit,
                        ethers.utils.defaultAbiCoder.encode(
                            [schainParametersType],
                            [{
                                lifetime: 5,
                                typeOfSchain: SchainType.TEST,
                                nonce: 0,
                                name: "D2",
                                originator: ethers.constants.AddressZero,
                                options: []
                            }]
                        )
                    ).should.be.eventually.rejectedWith("Schain name is not available");
                });

                it("should be able to delete schain", async () => {

                    await schains.deleteSchain(
                        holder.address,
                        "D2",
                    );
                    await schainsInternal.getSchains().should.be.eventually.empty;
                });

                it("should fail on deleting schain if owner is wrong", async () => {

                    await schains.deleteSchain(
                        nodeAddress1.address,
                        "D2",
                    ).should.be.eventually.rejectedWith("Message sender is not the owner of the Schain");
                });

            });

        });
    });

    describe("should calculate schain price", () => {
        it("of tiny schain", async () => {
            const price = await schains.getSchainPrice(1, 5);
            const correctPrice = 3952894150981;

            price.should.be.equal(correctPrice);
        });

        it("of small schain", async () => {
            const price = await schains.getSchainPrice(2, 5);
            const correctPrice = 15811576603926;

            price.should.be.equal(correctPrice);
        });

        it("of medium schain", async () => {
            const price = await schains.getSchainPrice(3, 5);
            const correctPrice = 505970451325642;

            price.should.be.equal(correctPrice);
        });

        it("of test schain", async () => {
            const price = await schains.getSchainPrice(4, 5);
            const correctPrice = BigNumber.from("1000000000000000000");

            price.should.be.equal(correctPrice);
        });

        it("of medium test schain", async () => {
            const price = await schains.getSchainPrice(5, 5);
            const correctPrice = 31623153207852;

            price.should.be.equal(correctPrice);
        });

        it("should revert on wrong schain type", async () => {
            await schains.getSchainPrice(6, 5).should.be.eventually.rejectedWith("Invalid type of schain");
        });
    });

    describe("when 4 nodes, 2 schains and 2 additional nodes created", () => {
        const ACTIVE = 0;
        const LEAVING = 1;
        const LEFT = 2;
        let nodeStatus;

        fastBeforeEach(async () => {
            const deposit = await schains.getSchainPrice(5, 5);
            const nodesCount = 4;
            for (const index of Array.from(Array(nodesCount).keys())) {
                const hexIndex = ("0" + index.toString(16)).slice(-2);
                await skaleManager.connect(nodeAddress1).createNode(
                    8545, // port
                    0, // nonce
                    "0x7f0000" + hexIndex, // ip
                    "0x7f0000" + hexIndex, // public ip
                    getPublicKey(nodeAddress1), // public key
                    "D2-" + hexIndex, // name
                    "some.domain.name");
            }
            await schains.addSchain(
                holder.address,
                deposit,
                ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
            );
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d2"),
            );

            await schains.addSchain(
                holder.address,
                deposit,
                ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d3",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
            );
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d3"),
            );
            await skaleManager.connect(nodeAddress1).createNode(
                8545, // port
                0, // nonce
                "0x7f000010", // ip
                "0x7f000010", // public ip
                getPublicKey(nodeAddress1), // public key
                "D2-10", // name
                "some.domain.name");
            await skaleManager.connect(nodeAddress1).createNode(
                8545, // port
                0, // nonce
                "0x7f000011", // ip
                "0x7f000011", // public ip
                getPublicKey(nodeAddress1), // public key
                "D2-11", // name
                "some.domain.name");
        });

        it("should reject initExit if node in maintenance", async () => {
            await nodes.setNodeInMaintenance(0);
            await nodes.initExit(0).should.be.eventually.rejectedWith("Node should be Active");
        });

        it("should rotate 2 nodes consistently", async () => {
            const res1 = await schainsInternal.getNodesInGroup(stringKeccak256("d2"));
            await schainsInternal.getNodesInGroup(stringKeccak256("d3"));
            await nodes.initExit(0);
            await skaleManager.connect(nodeAddress1).nodeExit(0);
            const leavingTimeOfNode = (await nodeRotation.getLeavingHistory(0))[0].finishedRotation.toNumber();
            const _12hours = 43200;
            assert.equal(await currentTime(), leavingTimeOfNode-_12hours);
            const rotatedSchain = (await nodeRotation.getLeavingHistory(0))[0].schainHash;
            const rotationForRotatedSchain = await nodeRotation.getRotation(rotatedSchain);
            rotationForRotatedSchain.newNodeIndex.should.be.not.equal(0);
            rotationForRotatedSchain.freezeUntil.should.be.not.equal(0);
            rotationForRotatedSchain.rotationCounter.should.be.not.equal(0);

            const activeSchain = await schainsInternal.getActiveSchain(0);
            const rotationForActiveSchain = await nodeRotation.getRotation(activeSchain);
            rotationForActiveSchain.nodeIndex.should.be.equal(0);
            rotationForActiveSchain.newNodeIndex.should.be.equal(0);
            rotationForActiveSchain.freezeUntil.should.be.not.equal(0);
            rotationForActiveSchain.rotationCounter.should.be.equal(0);

            const nodeRot = res1[3];
            await skaleDKG.isBroadcastPossible(
                stringKeccak256("d3"), nodeRot);
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d3"),
            );
            await nodes.initExit(1).should.be.eventually.rejectedWith("Occupied by rotation on Schain");
            await skaleManager.connect(nodeAddress1).nodeExit(0);
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d2"),
            );

            const rotationForSecondRotatedSchain = await nodeRotation.getRotation(activeSchain);
            rotationForSecondRotatedSchain.newNodeIndex.should.be.not.equal(0);
            rotationForSecondRotatedSchain.freezeUntil.should.be.not.equal(0);
            rotationForSecondRotatedSchain.rotationCounter.should.be.not.equal(0);

            nodeStatus = await nodes.getNodeStatus(0);
            assert.equal(nodeStatus, LEFT);
            await skaleManager.connect(nodeAddress1).nodeExit(0).should.be.eventually.rejectedWith("Sender is not permitted to call this function");

            nodeStatus = await nodes.getNodeStatus(1);
            assert.equal(nodeStatus, ACTIVE);
            await nodes.initExit(1).should.be.eventually.rejectedWith("Occupied by rotation on Schain");
            await skipTime(43260);

            await nodes.initExit(1);
            await skaleManager.connect(nodeAddress1).nodeExit(1);
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d3"),
            );
            nodeStatus = await nodes.getNodeStatus(1);
            assert.equal(nodeStatus, LEAVING);
            await skaleManager.connect(nodeAddress1).nodeExit(1);
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d2"),
            );
            nodeStatus = await nodes.getNodeStatus(1);
            assert.equal(nodeStatus, LEFT);
            await skaleManager.connect(nodeAddress1).nodeExit(1).should.be.eventually.rejectedWith("Sender is not permitted to call this function");
        });

        it("should rotate node on the same position", async () => {
            const arrayD2 = await schainsInternal.getNodesInGroup(stringKeccak256("d2"));
            const arrayD3 = await schainsInternal.getNodesInGroup(stringKeccak256("d3"));
            await nodes.initExit(0);
            await skaleManager.connect(nodeAddress1).nodeExit(0);
            const newArrayD3 = await schainsInternal.getNodesInGroup(stringKeccak256("d3"));
            let zeroPositionD3 = 0;
            let iter = 0;
            for (const nodeIndex of arrayD3) {
                if (nodeIndex.toNumber() === 0) {
                    zeroPositionD3 = iter;
                }
                iter++;
            }
            let exist4 = false;
            let exist5 = false;
            iter = 0;
            for (const nodeIndex of newArrayD3) {
                if (nodeIndex.toNumber() === 4) {
                    exist4 = true;
                }
                if (nodeIndex.toNumber() === 5) {
                    exist5 = true;
                }
                iter++;
            }
            assert.equal(exist4 && exist5, false);
            assert.equal(
                (exist5 && newArrayD3[zeroPositionD3].toNumber() === 5) ||
                (exist4 && newArrayD3[zeroPositionD3].toNumber() === 4),
                true
            );
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d3"),
            );
            await skaleManager.connect(nodeAddress1).nodeExit(0);
            const newArrayD2 = await schainsInternal.getNodesInGroup(stringKeccak256("d2"));
            let zeroPositionD2 = 0;
            iter = 0;
            for (const nodeIndex of arrayD2) {
                if (nodeIndex.toNumber() === 0) {
                    zeroPositionD2 = iter;
                }
                iter++;
            }
            exist4 = false;
            exist5 = false;
            iter = 0;
            for (const nodeIndex of newArrayD2) {
                if (nodeIndex.toNumber() === 4) {
                    exist4 = true;
                }
                if (nodeIndex.toNumber() === 5) {
                    exist5 = true;
                }
                iter++;
            }
            assert.equal(exist4 && exist5, false);
            assert.equal(
                (exist5 && newArrayD2[zeroPositionD2].toNumber() === 5) ||
                (exist4 && newArrayD2[zeroPositionD2].toNumber() === 4),
                true
            );
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d2"),
            );
            await skipTime(43260);
            await nodes.initExit(1);
            await skaleManager.connect(nodeAddress1).nodeExit(1);
            const newNewArrayD3 = await schainsInternal.getNodesInGroup(stringKeccak256("d3"));
            let onePositionD3 = 0;
            iter = 0;
            for (const nodeIndex of arrayD3) {
                if (nodeIndex.toNumber() === 1) {
                    onePositionD3 = iter;
                }
                iter++;
            }
            exist4 = false;
            exist5 = false;
            iter = 0;
            for (const nodeIndex of newNewArrayD3) {
                if (nodeIndex.toNumber() === 4 && iter !== zeroPositionD3) {
                    exist4 = true;
                }
                if (nodeIndex.toNumber() === 5 && iter !== zeroPositionD3) {
                    exist5 = true;
                }
                iter++;
            }
            assert.equal(exist4 && exist5, false);
            assert.equal(
                (exist5 && newNewArrayD3[onePositionD3].toNumber() === 5) ||
                (exist4 && newNewArrayD3[onePositionD3].toNumber() === 4),
                true
            );
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d3"),
            );
            await skaleManager.connect(nodeAddress1).nodeExit(1);
            const newNewArrayD2 = await schainsInternal.getNodesInGroup(stringKeccak256("d2"));
            let onePositionD2 = 0;
            iter = 0;
            for (const nodeIndex of arrayD2) {
                if (nodeIndex.toNumber() === 1) {
                    onePositionD2 = iter;
                }
                iter++;
            }
            exist4 = false;
            exist5 = false;
            iter = 0;
            for (const nodeIndex of newNewArrayD2) {
                if (nodeIndex.toNumber() === 4 && iter !== zeroPositionD2) {
                    exist4 = true;
                }
                if (nodeIndex.toNumber() === 5 && iter !== zeroPositionD2) {
                    exist5 = true;
                }
                iter++;
            }
            assert.equal(exist4 && exist5, false);
            assert.equal(
                (exist5 && newNewArrayD2[onePositionD2].toNumber() === 5) ||
                (exist4 && newNewArrayD2[onePositionD2].toNumber() === 4),
                true
            );
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d2"),
            );
        });

        it("should allow to rotate if occupied node didn't rotated for 12 hours", async () => {
            await nodes.initExit(0);
            await skaleManager.connect(nodeAddress1).nodeExit(0);
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d3"),
            );
            await nodes.initExit(1).should.be.eventually.rejectedWith("Occupied by rotation on Schain");
            await skipTime(43260);
            await nodes.initExit(1);
            await skaleManager.connect(nodeAddress1).nodeExit(1);
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d3"),
            );

            await skaleManager.connect(nodeAddress1).nodeExit(0).should.be.eventually.rejectedWith("Occupied by rotation on Schain");

            nodeStatus = await nodes.getNodeStatus(1);
            assert.equal(nodeStatus, LEAVING);
            await skaleManager.connect(nodeAddress1).nodeExit(1);
            nodeStatus = await nodes.getNodeStatus(1);
            assert.equal(nodeStatus, LEFT);
        });

        it("should not create schain with the same name after removing", async () => {
            const deposit = await schains.getSchainPrice(5, 5);
            await nodes.initExit(0);
            await skaleManager.connect(nodeAddress1).nodeExit(0);
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d3"),
            );
            await skaleManager.connect(nodeAddress1).nodeExit(0);
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d2"),
            );
            await skaleManager.connect(holder).deleteSchainByRoot("d2")
                .should.be.eventually.rejectedWith("SCHAIN_REMOVAL_ROLE is required");
            const SCHAIN_REMOVAL_ROLE = await skaleManager.SCHAIN_REMOVAL_ROLE();
            await skaleManager.grantRole(SCHAIN_REMOVAL_ROLE, holder.address);
            await skaleManager.connect(holder).deleteSchainByRoot("d2");
            await skaleManager.connect(holder).deleteSchainByRoot("d3");
            await schainsInternal.getActiveSchains(0).should.be.eventually.empty;
            await schainsInternal.getActiveSchains(1).should.be.eventually.empty;
            await schainsInternal.getActiveSchains(2).should.be.eventually.empty;
            await schainsInternal.getActiveSchains(3).should.be.eventually.empty;
            await schainsInternal.getActiveSchains(4).should.be.eventually.empty;
            await schainsInternal.getActiveSchains(5).should.be.eventually.empty;
            let schainNameAvailable = await schainsInternal.isSchainNameAvailable("d2");
            assert.equal(schainNameAvailable, false);
            await schains.addSchain(
                holder.address,
                deposit,
                ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
            ).should.be.eventually.rejectedWith("Schain name is not available");
            schainNameAvailable = await schainsInternal.isSchainNameAvailable("d3");
            assert.equal(schainNameAvailable, false);
            await schains.addSchain(
                holder.address,
                deposit,
                ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d3",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
            ).should.be.eventually.rejectedWith("Schain name is not available");
            schainNameAvailable = await schainsInternal.isSchainNameAvailable("d4");
            assert.equal(schainNameAvailable, true);
            await schains.addSchain(
                holder.address,
                deposit,
                ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d4",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
            );
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d4"),
            );
            const nodesInGroupBN = await schainsInternal.getNodesInGroup(stringKeccak256("d4"));
            const nodeInGroup = nodesInGroupBN.map((value: BigNumber) => value.toNumber())[0];
            await nodes.initExit(nodeInGroup);
            await skaleManager.connect(nodeAddress1).nodeExit(nodeInGroup);
        });

        it("should be possible to send broadcast", async () => {
            let res = await skaleDKG.isChannelOpened(stringKeccak256("d3"));
            assert.equal(res, false);
            await nodes.initExit(0);
            await skaleManager.connect(nodeAddress1).nodeExit(0);
            const res1 = await schainsInternal.getNodesInGroup(stringKeccak256("d3"));
            const nodeRot = res1[3];
            res = await skaleDKG.isChannelOpened(stringKeccak256("d3"));
            assert.equal(res, true);
            const resS = await skaleDKG.connect(nodeAddress1).isBroadcastPossible(stringKeccak256("d3"), nodeRot);
            assert.equal(resS, true);
        });

        it("should revert if dkg not finished", async () => {
            let res = await skaleDKG.isChannelOpened(stringKeccak256("d3"));
            assert.equal(res, false);
            await nodes.initExit(0);
            await skaleManager.connect(nodeAddress1).nodeExit(0);
            const res1 = await schainsInternal.getNodesInGroup(stringKeccak256("d3"));
            const nodeRot = res1[3];
            res = await skaleDKG.isChannelOpened(stringKeccak256("d3"));
            assert.equal(res, true);
            const resS = await skaleDKG.connect(nodeAddress1).isBroadcastPossible(stringKeccak256("d3"), nodeRot);
            assert.equal(resS, true);

            await nodes.initExit(1).should.be.eventually.rejectedWith("Occupied by rotation on Schain");
            await skaleManager.connect(nodeAddress1).nodeExit(0);

            await skipTime(43260);

            await nodes.initExit(1).should.be.eventually.rejectedWith("DKG did not finish on Schain");
        });

        it("should be possible to send broadcast", async () => {
            let res = await skaleDKG.isChannelOpened(stringKeccak256("d3"));
            assert.equal(res, false);
            await nodes.initExit(0);
            await skaleManager.connect(nodeAddress1).nodeExit(0);
            const res1 = await schainsInternal.getNodesInGroup(stringKeccak256("d3"));
            const nodeRot = res1[3];
            res = await skaleDKG.isChannelOpened(stringKeccak256("d3"));
            assert.equal(res, true);
            const resS = await skaleDKG.connect(nodeAddress1).isBroadcastPossible(stringKeccak256("d3"), nodeRot);
            assert.equal(resS, true);
            await skipTime(43260);
            await skaleManager.connect(nodeAddress1).nodeExit(0);

            await nodes.initExit(1).should.be.eventually.rejectedWith("DKG did not finish on Schain");
        });

        it("should be possible to send broadcast", async () => {
            let res = await skaleDKG.isChannelOpened(stringKeccak256("d3"));
            assert.equal(res, false);
            await nodes.initExit(0);
            await skaleManager.connect(nodeAddress1).nodeExit(0);
            const res1 = await schainsInternal.getNodesInGroup(stringKeccak256("d3"));
            const nodeRot = res1[3];
            res = await skaleDKG.isChannelOpened(stringKeccak256("d3"));
            assert.equal(res, true);
            const resS = await skaleDKG.connect(nodeAddress1).isBroadcastPossible(stringKeccak256("d3"), nodeRot);
            assert.equal(resS, true);
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d3"),
            );
            await nodes.initExit(1).should.be.eventually.rejectedWith("Occupied by rotation on Schain");
            await skaleManager.connect(nodeAddress1).nodeExit(0);
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d2"),
            );

            await skipTime(43260);

            await nodes.initExit(1)
            await skaleManager.connect(nodeAddress1).nodeExit(1);
        });

        it("should be possible to process dkg after node rotation", async () => {
            let res = await skaleDKG.isChannelOpened(stringKeccak256("d3"));
            assert.equal(res, false);
            await nodes.initExit(0)
            await skaleManager.connect(nodeAddress1).nodeExit(0);
            const res1 = await schainsInternal.getNodesInGroup(stringKeccak256("d3"));
            const nodeRot = res1[3];
            let resS = await skaleDKG.connect(nodeAddress1).isBroadcastPossible(stringKeccak256("d3"), nodeRot);
            assert.equal(resS, true);

            const verificationVector = [
                {
                    x: {
                        a: "0x02c2b888a23187f22195eadadbc05847a00dc59c913d465dbc4dfac9cfab437d",
                        b: "0x2695832627b9081e77da7a3fc4d574363bf051700055822f3d394dc3d9ff7417",
                    },
                    y: {
                        a: "0x24727c45f9322be756fbec6514525cbbfa27ef1951d3fed10f483c23f921879d",
                        b: "0x03a7a3e6f3b539dad43c0eca46e3f889b2b2300815ffc4633e26e64406625a99"
                    }
                },
                {
                    x: {
                        a: "0x02c2b888a23187f22195eadadbc05847a00dc59c913d465dbc4dfac9cfab437d",
                        b: "0x2695832627b9081e77da7a3fc4d574363bf051700055822f3d394dc3d9ff7417",
                    },
                    y: {
                        a: "0x24727c45f9322be756fbec6514525cbbfa27ef1951d3fed10f483c23f921879d",
                        b: "0x03a7a3e6f3b539dad43c0eca46e3f889b2b2300815ffc4633e26e64406625a99"
                    }
                },
                {
                    x: {
                        a: "0x02c2b888a23187f22195eadadbc05847a00dc59c913d465dbc4dfac9cfab437d",
                        b: "0x2695832627b9081e77da7a3fc4d574363bf051700055822f3d394dc3d9ff7417",
                    },
                    y: {
                        a: "0x24727c45f9322be756fbec6514525cbbfa27ef1951d3fed10f483c23f921879d",
                        b: "0x03a7a3e6f3b539dad43c0eca46e3f889b2b2300815ffc4633e26e64406625a99"
                    }
                }
            ];

            const encryptedSecretKeyContribution: {share: string, publicKey: [string, string]}[] = [
                {
                    share: "0x937c9c846a6fa7fd1984fe82e739ae37fcaa555c1dc0e8597c9f81b6a12f232f",
                    publicKey: [
                        "0xfdf8101e91bd658fa1cea6fdd75adb8542951ce3d251cdaa78f43493dad730b5",
                        "0x9d32d2e872b36aa70cdce544b550ebe96994de860b6f6ebb7d0b4d4e6724b4bf"
                    ]
                },
                {
                    share: "0x7232f27fdfe521f3c7997dbb1c15452b7f196bd119d915ce76af3d1a008e1810",
                    publicKey: [
                        "0x086ff076abe442563ae9b8938d483ae581f4de2ee54298b3078289bbd85250c8",
                        "0xdf956450d32f671e4a8ec1e584119753ff171e80a61465246bfd291e8dac3d77"
                    ]
                },
                {
                    share: "0x7232f27fdfe521f3c7997dbb1c15452b7f196bd119d915ce76af3d1a008e1810",
                    publicKey: [
                        "0x086ff076abe442563ae9b8938d483ae581f4de2ee54298b3078289bbd85250c8",
                        "0xdf956450d32f671e4a8ec1e584119753ff171e80a61465246bfd291e8dac3d77"
                    ]
                },
                {
                    share: "0x7232f27fdfe521f3c7997dbb1c15452b7f196bd119d915ce76af3d1a008e1810",
                    publicKey: [
                        "0x086ff076abe442563ae9b8938d483ae581f4de2ee54298b3078289bbd85250c8",
                        "0xdf956450d32f671e4a8ec1e584119753ff171e80a61465246bfd291e8dac3d77"
                    ]
                }
            ];

            // let res10 = await keyStorage.getBroadcastedData(stringKeccak256("d3"), res1[0]);
            resS = await skaleDKG.connect(nodeAddress1).isBroadcastPossible(stringKeccak256("d3"), res1[0]);
            assert.equal(resS, true);
            await wallets.connect(owner).rechargeSchainWallet(stringKeccak256("d3"), {value: 1e20.toString()});
            await skaleDKG.connect(nodeAddress1).broadcast(
                stringKeccak256("d3"),
                res1[0],
                verificationVector,
                // the last symbol is spoiled in parameter below
                encryptedSecretKeyContribution
            );
            // res10 = await keyStorage.getBroadcastedData(stringKeccak256("d3"), res1[1]);
            resS = await skaleDKG.connect(nodeAddress1).isBroadcastPossible(stringKeccak256("d3"), res1[1]);
            assert.equal(resS, true);
            await skaleDKG.connect(nodeAddress1).broadcast(
                stringKeccak256("d3"),
                res1[1],
                verificationVector,
                // the last symbol is spoiled in parameter below
                encryptedSecretKeyContribution
            );
            resS = await skaleDKG.connect(nodeAddress1).isBroadcastPossible(stringKeccak256("d3"), res1[2]);
            assert.equal(resS, true);
            await skaleDKG.connect(nodeAddress1).broadcast(
                stringKeccak256("d3"),
                res1[2],
                verificationVector,
                // the last symbol is spoiled in parameter below
                encryptedSecretKeyContribution
            );
            await skaleDKG.connect(nodeAddress1).broadcast(
                stringKeccak256("d3"),
                res1[3],
                verificationVector,
                // the last symbol is spoiled in parameter below
                encryptedSecretKeyContribution
            );

            res = await skaleDKG.isChannelOpened(stringKeccak256("d3"));
            assert.equal(res, true);

            resS = await skaleDKG.connect(nodeAddress1).isAlrightPossible(
                stringKeccak256("d3"),
                res1[0]
            );
            assert.equal(resS, true);

            await skaleDKG.connect(nodeAddress1).alright(
                stringKeccak256("d3"),
                res1[0]
            );

            res = await skaleDKG.isChannelOpened(stringKeccak256("d3"));
            assert.equal(res, true);

            resS = await skaleDKG.connect(nodeAddress1).isAlrightPossible(
                stringKeccak256("d3"),
                res1[1]
            );
            assert.equal(resS, true);

            await skaleDKG.connect(nodeAddress1).alright(
                stringKeccak256("d3"),
                res1[1]
            );

            res = await skaleDKG.isChannelOpened(stringKeccak256("d3"));
            assert.equal(res, true);

            resS = await skaleDKG.connect(nodeAddress1).isAlrightPossible(
                stringKeccak256("d3"),
                res1[2]
            );
            assert.equal(resS, true);

            await skaleDKG.connect(nodeAddress1).alright(
                stringKeccak256("d3"),
                res1[2]
            );

            res = await skaleDKG.isChannelOpened(stringKeccak256("d3"));
            assert.equal(res, true);

            resS = await skaleDKG.connect(nodeAddress1).isAlrightPossible(
                stringKeccak256("d3"),
                res1[3]
            );
            assert.equal(resS, true);

            await skaleDKG.connect(nodeAddress1).alright(
                stringKeccak256("d3"),
                res1[3]
            );
        });
    });

    describe("when 6 nodes, 4 schains and 2 rotations(Kavoon test)", () => {

        fastBeforeEach(async () => {
            const deposit = await schains.getSchainPrice(5, 5);
            const nodesCount = 6;
            for (const index of Array.from(Array(nodesCount).keys())) {
                const hexIndex = ("0" + index.toString(16)).slice(-2);
                await skaleManager.connect(nodeAddress1).createNode(
                    8545, // port
                    0, // nonce
                    "0x7f0000" + hexIndex, // ip
                    "0x7f0000" + hexIndex, // public ip
                    getPublicKey(nodeAddress1), // public key
                    "D2-" + hexIndex, // name
                    "some.domain.name");
            }
            await schains.addSchain(
                holder.address,
                deposit,
                ethers.utils.defaultAbiCoder.encode(
                    [schainParametersType],
                    [{
                        lifetime: 5,
                        typeOfSchain: SchainType.MEDIUM_TEST,
                        nonce: 0,
                        name: "d1",
                        originator: ethers.constants.AddressZero,
                        options: []
                    }]
                )
            );
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d1"),
            );

            await schains.addSchain(
                holder.address,
                deposit,
                ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
            );
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d2"),
            );

            await schains.addSchain(
                holder.address,
                deposit,
                ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d3",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
            );
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d3"),
            );

            await schains.addSchain(
                holder.address,
                deposit,
                ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d4",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
            );
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d4"),
            );

        });

        it("should rotate 1 node with 3 schains", async () => {
            let rotIndex = 7;
            let schainHashes = await schainsInternal.getActiveSchains(0);
            for(const index of Array(6).keys()) {
                const res = await schainsInternal.getActiveSchains(index);
                if (res.length >= 3) {
                    rotIndex = index;
                    schainHashes = res;
                    break;
                }
            }
            await nodes.initExit(rotIndex);
            for (const schainHash of Array.from(schainHashes).reverse()) {
                await skaleManager.connect(nodeAddress1).nodeExit(rotIndex);
                await skaleDKG.setSuccessfulDKGPublic(schainHash);
            }
            await schainsInternal.getActiveSchains(rotIndex).should.be.eventually.empty;
        });

        it("should rotate another 1 node with 4 schains", async () => {
            let rotIndex1 = 7;
            let schainHashes1 = await schainsInternal.getActiveSchains(0);
            for(const index of Array.from(Array(6).keys())) {
                const res = await schainsInternal.getActiveSchains(index);
                if (res.length >= 3) {
                    rotIndex1 = index;
                    schainHashes1 = res;
                    break;
                }
            }
            await nodes.initExit(rotIndex1);
            for (const schainHash of Array.from(schainHashes1).reverse()) {
                await skaleManager.connect(nodeAddress1).nodeExit(rotIndex1);
                await skaleDKG.setSuccessfulDKGPublic(
                    schainHash,
                );
            }
            await schainsInternal.getActiveSchains(rotIndex1).should.be.eventually.empty;
            let rotIndex2 = 7;
            let schainHashes2 = await schainsInternal.getActiveSchains(0);
            for(const index of Array.from(Array(6).keys())) {
                if (await nodes.isNodeActive(index)) {
                    const res = await schainsInternal.getActiveSchains(index);
                    if (res.length === 4) {
                        rotIndex2 = index;
                        schainHashes2 = res;
                        break;
                    }
                }
            }

            await skipTime(43260);
            await nodes.initExit(rotIndex2);
            for (const schainHash of Array.from(schainHashes2).reverse()) {
                await skaleManager.connect(nodeAddress1).nodeExit(rotIndex2);
                await skaleDKG.setSuccessfulDKGPublic(
                    schainHash,
                );
            }
            await schainsInternal.getActiveSchains(rotIndex2).should.be.eventually.empty;
            await schainsInternal.getActiveSchains(rotIndex1).should.be.eventually.empty;
        });
    });

    describe("when 8 nodes, 4 schains and 2 rotations(Kavoon test)", () => {

        fastBeforeEach(async () => {
            const deposit = await schains.getSchainPrice(5, 5);
            const nodesCount = 6;
            for (const index of Array.from(Array(nodesCount).keys())) {
                const hexIndex = ("0" + index.toString(16)).slice(-2);
                await skaleManager.connect(nodeAddress1).createNode(
                    8545, // port
                    0, // nonce
                    "0x7f0000" + hexIndex, // ip
                    "0x7f0000" + hexIndex, // public ip
                    getPublicKey(nodeAddress1), // public key
                    "D2-" + hexIndex, // name
                    "some.domain.name");
            }
            await skaleManager.connect(nodeAddress2).createNode(
                8545, // port
                0, // nonce
                "0x7f0000ff", // ip
                "0x7f0000ff", // public ip
                getPublicKey(nodeAddress2), // public key
                "D2-ff", // name
                "some.domain.name");
            await skaleManager.connect(nodeAddress3).createNode(
                8545, // port
                0, // nonce
                "0x7f0000fe", // ip
                "0x7f0000fe", // public ip
                getPublicKey(nodeAddress3), // public key
                "D2-fe", // name
                "some.domain.name");
            await schains.addSchain(
                holder.address,
                deposit,
                ethers.utils.defaultAbiCoder.encode(
                    [schainParametersType],
                    [{
                        lifetime: 5,
                        typeOfSchain: SchainType.MEDIUM_TEST,
                        nonce: 0,
                        name: "d1",
                        originator: ethers.constants.AddressZero,
                        options: []
                    }]
                )
            );
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d1"),
            );

            await schains.addSchain(
                holder.address,
                deposit,
                ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
            );
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d2"),
            );

            await schains.addSchain(
                holder.address,
                deposit,
                ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d3",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
            );
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d3"),
            );

            await schains.addSchain(
                holder.address,
                deposit,
                ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: SchainType.MEDIUM_TEST,
                            nonce: 0,
                            name: "d4",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
            );
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d4"),
            );

        });

        it("should rotate 1 node with 3 schains", async () => {
            let rotIndex = 8;
            let schainHashes = await schainsInternal.getActiveSchains(0);
            for(const index of Array.from(Array(6).keys())) {
                const res = await schainsInternal.getActiveSchains(index);
                if (res.length >= 3) {
                    rotIndex = index;
                    schainHashes = res;
                    break;
                }
            }
            if (rotIndex < 8) {
                await nodes.initExit(rotIndex);
            }
            for (const schainHash of Array.from(schainHashes).reverse()) {
                if (rotIndex === 7) {
                    await skaleManager.connect(nodeAddress1).nodeExit(rotIndex);
                } else if (rotIndex === 6) {
                    await skaleManager.connect(nodeAddress2).nodeExit(rotIndex);
                } else if (rotIndex < 6) {
                    await skaleManager.connect(nodeAddress1).nodeExit(rotIndex);
                } else {
                    break;
                }
                await skaleDKG.setSuccessfulDKGPublic(
                    schainHash,
                );
            }
            await schainsInternal.getActiveSchains(rotIndex).should.be.eventually.empty;
        });

        it("should rotate another 1 node with 4 schains", async () => {
            let rotIndex1 = 8;
            let schainHashes1 = await schainsInternal.getActiveSchains(0);
            for(const index of Array.from(Array(6).keys())) {
                const res = await schainsInternal.getActiveSchains(index);
                if (res.length >= 3) {
                    rotIndex1 = index;
                    schainHashes1 = res;
                    break;
                }
            }
            if (rotIndex1 < 8) {
                await nodes.initExit(rotIndex1);
            }
            for (const schainHash of Array.from(schainHashes1).reverse()) {
                if (rotIndex1 === 7) {
                    await skaleManager.connect(nodeAddress1).nodeExit(rotIndex1);
                } else if (rotIndex1 === 6) {
                    await skaleManager.connect(nodeAddress2).nodeExit(rotIndex1);
                } else if (rotIndex1 < 6) {
                    await skaleManager.connect(nodeAddress1).nodeExit(rotIndex1);
                } else {
                    break;
                }
                await skaleDKG.setSuccessfulDKGPublic(
                    schainHash,
                );
            }
            await schainsInternal.getActiveSchains(rotIndex1).should.be.eventually.empty;
            let rotIndex2 = 8;
            let schainHashes2 = await schainsInternal.getActiveSchains(0);
            for(const index of Array.from(Array(6).keys())) {
                if (await nodes.isNodeActive(index)) {
                    const res = await schainsInternal.getActiveSchains(index);
                    if (res.length === 4) {
                        rotIndex2 = index;
                        schainHashes2 = res;
                        break;
                    }
                }
            }

            await skipTime(43260);
            if (rotIndex2 < 8 && rotIndex2 !== rotIndex1) {
                await nodes.initExit(rotIndex2);
            }
            for (const schainHash of Array.from(schainHashes2).reverse()) {
                if (rotIndex2 === 7) {
                    await skaleManager.connect(nodeAddress1).nodeExit(rotIndex2);
                } else if (rotIndex2 === 6) {
                    await skaleManager.connect(nodeAddress2).nodeExit(rotIndex2);
                } else if (rotIndex2 < 6) {
                    await skaleManager.connect(nodeAddress1).nodeExit(rotIndex2);
                } else {
                    break;
                }
                await skaleDKG.setSuccessfulDKGPublic(
                    schainHash,
                );
            }
            await schainsInternal.getActiveSchains(rotIndex2).should.be.eventually.empty;
            await schainsInternal.getActiveSchains(rotIndex1).should.be.eventually.empty;
        });

        it("should rotate 7 node and unlink from Validator", async () => {
            const rotIndex = 6;
            const schainHashes = await schainsInternal.getActiveSchains(rotIndex);
            await nodes.initExit(rotIndex);
            for (const schainHash of Array.from(schainHashes).reverse()) {
                await validatorService.getValidatorIdByNodeAddress(nodeAddress2.address);
                ((await validatorService.getValidatorIdByNodeAddress(nodeAddress2.address)).toString()).should.be.equal("1");
                await skaleManager.connect(nodeAddress2).nodeExit(rotIndex);
                await skaleDKG.setSuccessfulDKGPublic(
                    schainHash,
                );
            }
            if (!(await nodes.isNodeLeft(rotIndex))) {
                await skaleManager.connect(nodeAddress2).nodeExit(rotIndex);
            }
            await validatorService.getValidatorIdByNodeAddress(nodeAddress2.address)
            .should.be.eventually.rejectedWith("Node address is not assigned to a validator");
            await schainsInternal.getActiveSchains(rotIndex).should.be.eventually.empty;
        });

        it("should rotate 7 node from validator address", async () => {
            const rotatedNodeIndex = 6;
            const schainHashes = await schainsInternal.getActiveSchains(rotatedNodeIndex);
            await nodes.initExit(rotatedNodeIndex);
            for (const schainHash of Array.from(schainHashes).reverse()) {
                const validatorId = await validatorService.getValidatorIdByNodeAddress(nodeAddress2.address);
                validatorId.toString().should.be.equal("1");
                await skaleManager.connect(validator).nodeExit(rotatedNodeIndex);
                await skaleDKG.setSuccessfulDKGPublic(schainHash);
            }
            if (!(await nodes.isNodeLeft(rotatedNodeIndex))) {
                await skaleManager.connect(validator).nodeExit(rotatedNodeIndex);
            }
            await validatorService.getValidatorIdByNodeAddress(nodeAddress2.address)
                .should.be.eventually.rejectedWith("Node address is not assigned to a validator");
            await schainsInternal.getActiveSchains(rotatedNodeIndex).should.be.eventually.empty;
        });

        it("should rotate 7 node from contract owner address", async () => {
            const rotatedNodeIndex = 6;
            const schainHashes = await schainsInternal.getActiveSchains(rotatedNodeIndex);
            await nodes.initExit(rotatedNodeIndex);
            for (const schainHash of Array.from(schainHashes).reverse()) {
                const validatorId = await validatorService.getValidatorIdByNodeAddress(nodeAddress2.address);
                validatorId.toString().should.be.equal("1");
                await skaleManager.nodeExit(rotatedNodeIndex);
                await skaleDKG.setSuccessfulDKGPublic(schainHash);
            }
            if (!(await nodes.isNodeLeft(rotatedNodeIndex))) {
                await skaleManager.nodeExit(rotatedNodeIndex);
            }
            await validatorService.getValidatorIdByNodeAddress(nodeAddress2.address)
                .should.be.eventually.rejectedWith("Node address is not assigned to a validator");
            await schainsInternal.getActiveSchains(rotatedNodeIndex).should.be.eventually.empty;
        });

        it("should rotate 8 node and unlink from Validator", async () => {
            const rotIndex = 7;
            const schainHashes = await schainsInternal.getActiveSchains(rotIndex);
            await nodes.initExit(rotIndex);
            for (const schainHash of Array.from(schainHashes).reverse()) {
                await validatorService.getValidatorIdByNodeAddress(nodeAddress3.address);
                ((await validatorService.getValidatorIdByNodeAddress(nodeAddress3.address)).toString()).should.be.equal("1");
                await skaleManager.connect(nodeAddress3).nodeExit(rotIndex);
                await skaleDKG.setSuccessfulDKGPublic(
                    schainHash,
                );
            }
            if (!(await nodes.isNodeLeft(rotIndex))) {
                await skaleManager.connect(nodeAddress3).nodeExit(rotIndex);
            }
            await validatorService.getValidatorIdByNodeAddress(nodeAddress3.address)
            .should.be.eventually.rejectedWith("Node address is not assigned to a validator");
            await schainsInternal.getActiveSchains(rotIndex).should.be.eventually.empty;
        });

        it("should check rotation in progress", async () => {
            let rotIndex = 0;
            let schainHashes = await schainsInternal.getActiveSchains(rotIndex);

            for(const index of Array.from(Array(6).keys())) {
                const res = await schainsInternal.getActiveSchains(index);
                if (res.length >= 3) {
                    rotIndex = index;
                    schainHashes = res;
                    break;
                }
            }

            let senderAddress = nodeAddress1;
            if (rotIndex === 6) {
                senderAddress = nodeAddress2;
            } else if (rotIndex === 7) {
                senderAddress = nodeAddress3;
            }

            await nodes.initExit(rotIndex);
            for (const schainHash of Array.from(schainHashes).reverse()) {
                (await nodeRotation.isRotationInProgress(schainHash)).should.be.true;
                (await nodeRotation.isNewNodeFound(schainHash)).should.be.false;
            }

            const rotDelay = await constantsHolder.rotationDelay();
            const tenSecDelta = 10;

            await skipTime(rotDelay.toNumber() - tenSecDelta);

            for (const schainHash of Array.from(schainHashes).reverse()) {
                (await nodeRotation.isRotationInProgress(schainHash)).should.be.true;
                (await nodeRotation.isNewNodeFound(schainHash)).should.be.false;
            }

            await skipTime(tenSecDelta + 1);

            for (const schainHash of Array.from(schainHashes).reverse()) {
                (await nodeRotation.isRotationInProgress(schainHash)).should.be.false;
            }

            await skaleManager.connect(senderAddress).nodeExit(rotIndex);
            await skaleDKG.setSuccessfulDKGPublic(
                schainHashes[schainHashes.length - 1],
            );


            for (const schainHash of Array.from(schainHashes).reverse()) {
                if (schainHash == schainHashes[schainHashes.length - 1]) {
                    (await nodeRotation.isRotationInProgress(schainHash)).should.be.true;
                    (await nodeRotation.isNewNodeFound(schainHash)).should.be.true;
                } else {
                    (await nodeRotation.isRotationInProgress(schainHash)).should.be.false;
                    (await nodeRotation.isNewNodeFound(schainHash)).should.be.false;
                }
            }

            await skipTime(rotDelay.toNumber() + 1);

            for (const schainHash of Array.from(schainHashes).reverse()) {
                (await nodeRotation.isRotationInProgress(schainHash)).should.be.false;
            }

            if (!(await nodes.isNodeLeft(rotIndex))) {

                while (!(await nodes.isNodeLeft(rotIndex))) {
                    await skaleManager.connect(senderAddress).nodeExit(rotIndex);
                }

                for (const schainHash of Array.from(schainHashes).reverse()) {
                    if (schainHash != schainHashes[schainHashes.length - 1]) {
                        await skaleDKG.setSuccessfulDKGPublic(
                            schainHash,
                        );
                    }
                }

                for (const schainHash of Array.from(schainHashes).reverse()) {
                    if (schainHash != schainHashes[schainHashes.length - 1]) {
                        (await nodeRotation.isRotationInProgress(schainHash)).should.be.true;
                        (await nodeRotation.isNewNodeFound(schainHash)).should.be.true;
                    }
                }

                await skipTime(rotDelay.toNumber() + 1);

                for (const schainHash of Array.from(schainHashes).reverse()) {
                    (await nodeRotation.isRotationInProgress(schainHash)).should.be.false;
                }
            }

        });
    });

    describe("when 17 nodes, 1 schain and remove schain type", () => {

        const encryptedSecretKeyContributions: {share: string, publicKey: [string, string]}[][] = [
            [
                {
                    share: "0xc54860dc759e1c6095dfaa33e0b045fc102551e654cec47c7e1e9e2b33354ca6",
                    publicKey: [
                        "0xf676847eeff8f52b6f22c8b590aed7f80c493dfa2b7ec1cff3ae3049ed15c767",
                        "0xe5c51a3f401c127bde74fefce07ed225b45e7975fccf4a10c12557ae8036653b"
                    ]
                },
                {
                    share: "0xdb68ca3cb297158e493e137ce0ab5fddd2cec34b3a15a4ee1aec9dfcc61dfd15",
                    publicKey: [
                        "0xdc1282664acf84218bf29112357c78f46766c783e7b7ead43db07d5d9fd74ca9",
                        "0x85569644dc1a5bc374d3833a5c5ff3aaa26fa4050ff738d442b34087d4d8f3aa"
                    ]
                }
            ],
            [
                {
                    share: "0x7bb14ad459adba781466c3441e10eeb3148c152b4919b126a0166fd1dac824ba",
                    publicKey: [
                        "0x89051df58e7d7cec9c6816d65a17f068409aa37200cd544d263104c1b9dbd037",
                        "0x435e1a25c9b9f95627ec141e14826f0d0e798c793d470388865dccb461c19773"
                    ]
                },
                {
                    share: "0xa6b44d487799470fc5da3e359d21b976a146d7345ed90782c1d034d1ceef53bf",
                    publicKey: [
                        "0x78b59fd523f23097483958ec5cd4308e5805a261961fe629bf7dc9674ed2ec94",
                        "0xaa4244b53891263f79f6df64a82592dab46a6be903c29c15170d785e493ff9c2"
                    ]
                }
            ]
        ];
        const verificationVectors: {x: {a: string, b: string}, y: {a: string, b: string}}[][] = [
            [
                {
                    x: {
                        a: "0x2603b519d8eacb84244da4f264a888b292214ed2d2fad9368bc12c2a9a5a5f25",
                        b: "0x2d8b197411929589919db23a989c1fd619a53a47db14dab3fd952490c7bf0615"
                    },
                    y: {
                        a: "0x2e99d40faf53cc640065fa674948a0a9b169c303afc5d061bac6ef4c7c1fc400",
                        b: "0x1b9afd2c7c3aeb9ef31f357491d4f1c2b889796297460facaa81ce8c15c3680"
                    }
                }
            ],
            [
                {
                    x: {
                        a: "0x2a21918482ff2503b08a38dd5bf119b1a0a6bca910dfd9052fa6792f01624f20",
                        b: "0xa55dec4eb79493ec63aed84aebbc016c2ab11e335d3d465519ffbfa15416ced",
                    },
                    y: {
                        a: "0x13b919159469023fad82fedae095a2359f600f0a8a09f32bab6250e1688f0852",
                        b: "0x269279ef4c2fcd6ca475c522406444ee79ffa796a645f9953b3d4d003f8f7294"
                    }
                }
            ]
        ];
        const secretKeyContributions: {share: string, publicKey: [string, string]}[] = [];
        const verificationVectorNew: {x: {a: string, b: string}, y: {a: string, b: string}}[] = [];
        const schainName = "d1";
        const schainHash = stringKeccak256(schainName);
        const schainType = SchainType.MEDIUM;
        const schainWalletValue = 1e20.toString();

        fastBeforeEach(async () => {
            const deposit = await schains.getSchainPrice(schainType, 5);
            const nodesCount = 16;
            for (const index of Array.from(Array(nodesCount).keys())) {
                const hexIndex = ("0" + index.toString(16)).slice(-2);
                await skaleManager.connect(nodeAddress1).createNode(
                    8545, // port
                    0, // nonce
                    "0x7f0000" + hexIndex, // ip
                    "0x7f0000" + hexIndex, // public ip
                    getPublicKey(nodeAddress1), // public key
                    "D2-" + hexIndex, // name
                    "some.domain.name");
            }
            await schains.addSchain(
                holder.address,
                deposit,
                ethers.utils.defaultAbiCoder.encode(
                    [schainParametersType],
                    [{
                        lifetime: 5,
                        typeOfSchain: schainType,
                        nonce: 0,
                        name: schainName,
                        originator: ethers.constants.AddressZero,
                        options: []
                    }]
                )
            );
            await wallets.rechargeSchainWallet(schainHash, {value: schainWalletValue});
            await skaleDKG.setSuccessfulDKGPublic(schainHash);
            await skaleManager.connect(nodeAddress2).createNode(
                8545, // port
                0, // nonce
                "0x7f0000ff", // ip
                "0x7f0000ff", // public ip
                getPublicKey(nodeAddress2), // public key
                "D2-ff", // name
                "some.domain.name");

            for (let i = 0; i < 16; i++) {
                secretKeyContributions[i] = encryptedSecretKeyContributions[0][0];
            }
            for (let i = 0; i < 11; i++) {
                verificationVectorNew[i] = verificationVectors[i % 2][0];
            }
        });

        it("should get space on node", async () => {
            for(let i = 0; i < 16; i++) {
                expect((await nodes.spaceOfNodes(i)).freeSpace).to.be.equal(124)
            }
            expect((await nodes.spaceOfNodes(16)).freeSpace).to.be.equal(128)
        });

        it("should make a node rotation", async () => {
            const rotIndex = 0;
            await nodes.initExit(rotIndex);
            await skaleManager.connect(nodeAddress1).nodeExit(rotIndex);
            await skaleManager.connect(nodeAddress1).createNode(
                8545, // port
                0, // nonce
                "0x7f0000fe", // ip
                "0x7f0000fe", // public ip
                getPublicKey(nodeAddress1), // public key
                "D2-fe", // name
                "some.domain.name");
            await skaleDKG.connect(nodeAddress1).broadcast(
                stringKeccak256("d1"),
                1,
                verificationVectorNew,
                secretKeyContributions
            );
            await skipTime(1800);
            await skaleDKG.connect(nodeAddress1).complaint(
                stringKeccak256("d1"),
                1,
                16
            );
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d1"),
            );

            for(let i = 1; i < 18; i++) {
                if (i !== 16) {
                    expect((await nodes.spaceOfNodes(i)).freeSpace).to.be.equal(124);
                }
            }
            expect((await nodes.spaceOfNodes(16)).freeSpace).to.be.equal(128)
        });

        it("should make a node rotation after removing schain type", async () => {
            await schainsInternal.removeSchainType(1);
            const rotIndex = 0;
            await nodes.initExit(rotIndex);
            await skaleManager.connect(nodeAddress1).nodeExit(rotIndex);
            await skaleManager.connect(nodeAddress1).createNode(
                8545, // port
                0, // nonce
                "0x7f0000fe", // ip
                "0x7f0000fe", // public ip
                getPublicKey(nodeAddress1), // public key
                "D2-fe", // name
                "some.domain.name");
            await skaleDKG.connect(nodeAddress1).broadcast(
                stringKeccak256("d1"),
                1,
                verificationVectorNew,
                secretKeyContributions
            );
            await skipTime(1800);
            await skaleDKG.connect(nodeAddress1).complaint(
                stringKeccak256("d1"),
                1,
                16
            );
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d1"),
            );

            for(let i = 1; i < 18; i++) {
                if (i !== 16) {
                    expect((await nodes.spaceOfNodes(i)).freeSpace).to.be.equal(124);
                }
            }
            expect((await nodes.spaceOfNodes(16)).freeSpace).to.be.equal(128)
        });

        it("should make a node rotation after removing schain type and adding new schain type", async () => {
            await schainsInternal.removeSchainType(1);
            await schainsInternal.addSchainType(32, 16);
            const rotIndex = 0;
            await nodes.initExit(rotIndex);
            await skaleManager.connect(nodeAddress1).nodeExit(rotIndex);
            await skaleManager.connect(nodeAddress1).createNode(
                8545, // port
                0, // nonce
                "0x7f0000fe", // ip
                "0x7f0000fe", // public ip
                getPublicKey(nodeAddress1), // public key
                "D2-fe", // name
                "some.domain.name");

            await skaleDKG.connect(nodeAddress1).broadcast(
                stringKeccak256("d1"),
                1,
                verificationVectorNew,
                secretKeyContributions
            );
            await skipTime(1800);
            await skaleDKG.connect(nodeAddress1).complaint(
                stringKeccak256("d1"),
                1,
                16
            );
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d1"),
            );

            for(let i = 1; i < 18; i++) {
                if (i !== 16) {
                    expect((await nodes.spaceOfNodes(i)).freeSpace).to.be.equal(124);
                }
            }
            expect((await nodes.spaceOfNodes(16)).freeSpace).to.be.equal(128)
        });

        it("should make a node rotation creating an schain of new schain type", async () => {
            await schainsInternal.removeSchainType(1);
            await schainsInternal.addSchainType(32, 16);
            const deposit = await schains.getSchainPrice(6, 5);
            const rotIndex = 0;
            await nodes.initExit(rotIndex);
            await skaleManager.connect(nodeAddress1).nodeExit(rotIndex);
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d1"),
            );
            await skipTime(46200);
            await schains.addSchain(
                holder.address,
                deposit,
                ethers.utils.defaultAbiCoder.encode(
                        [schainParametersType],
                        [{
                            lifetime: 5,
                            typeOfSchain: 6,
                            nonce: 0,
                            name: "d2",
                            originator: ethers.constants.AddressZero,
                            options: []
                        }]
                    )
            );
            await wallets.rechargeSchainWallet(stringKeccak256("d2"), {value: 1e20.toString()});
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d2"),
            );
            await skaleManager.connect(nodeAddress1).createNode(
                8545, // port
                0, // nonce
                "0x7f0000fe", // ip
                "0x7f0000fe", // public ip
                getPublicKey(nodeAddress1), // public key
                "D2-fe", // name
                "some.domain.name");
            const rotIndex2 = 1;
            await nodes.initExit(rotIndex2);
            while(await nodes.getNodeStatus(rotIndex2) !== 2) {
                await skaleManager.connect(nodeAddress1).nodeExit(rotIndex2);
            }
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d2"),
            );
            await skaleManager.connect(nodeAddress1).createNode(
                8545, // port
                0, // nonce
                "0x7f0000fd", // ip
                "0x7f0000fd", // public ip
                getPublicKey(nodeAddress1), // public key
                "D2-fd", // name
                "some.domain.name");

            await skaleDKG.connect(nodeAddress1).broadcast(
                stringKeccak256("d1"),
                2,
                verificationVectorNew,
                secretKeyContributions
            );
            await skipTime(1800);
            await skaleDKG.connect(nodeAddress1).complaint(
                stringKeccak256("d1"),
                2,
                16
            );
            await skaleDKG.setSuccessfulDKGPublic(
                stringKeccak256("d1"),
            );

            for(let i = 2; i < 18; i++) {
                if (i !== 16) {
                    expect((await nodes.spaceOfNodes(i)).freeSpace).to.be.equal(92);
                }
            }
            expect((await nodes.spaceOfNodes(18)).freeSpace).to.be.equal(124);
            expect((await nodes.spaceOfNodes(16)).freeSpace).to.be.equal(96);
        });

        it("should make a node exit if schain was removed", async () => {
            await skaleManager.grantRole(await skaleManager.SCHAIN_REMOVAL_ROLE(), owner.address);

            const leavingNodeIndex = 0;
            await nodes.initExit(leavingNodeIndex);
            await skaleManager.deleteSchainByRoot(schainName);
            await skaleManager.connect(nodeAddress1).nodeExit(leavingNodeIndex);

            await nodes.isNodeLeft(leavingNodeIndex).should.eventually.be.true;

            const numberOfNodes = (await nodes.getNumberOfNodes()).toNumber();
            for(let i = 0; i < numberOfNodes; i++) {
                if (i !== leavingNodeIndex) {
                    expect((await nodes.spaceOfNodes(i)).freeSpace).to.be.equal(128);
                }
            }
        });

        it("should make a node exit if 1 of 3 schains was removed", async () => {
            const schain2Name = "Schain2";
            const schain2Hash = stringKeccak256(schain2Name);
            const schain3Name = "Schain3";
            const schain3Hash = stringKeccak256(schain3Name);
            const lifetime = 5;
            const deposit = await schains.getSchainPrice(schainType, lifetime);

            await skaleManager.grantRole(await skaleManager.SCHAIN_REMOVAL_ROLE(), owner.address);

            // create schain 2
            await schains.addSchain(
                holder.address,
                deposit,
                ethers.utils.defaultAbiCoder.encode(
                    [schainParametersType],
                    [{
                        lifetime: lifetime,
                        typeOfSchain: schainType,
                        nonce: 0,
                        name: schain2Name,
                        originator: ethers.constants.AddressZero,
                        options: []
                    }]
                )
            );
            await wallets.rechargeSchainWallet(schain2Hash, {value: schainWalletValue});
            await skaleDKG.setSuccessfulDKGPublic(schain2Hash);

            // create schain 3
            await schains.addSchain(
                holder.address,
                deposit,
                ethers.utils.defaultAbiCoder.encode(
                    [schainParametersType],
                    [{
                        lifetime: lifetime,
                        typeOfSchain: schainType,
                        nonce: 0,
                        name: schain3Name,
                        originator: ethers.constants.AddressZero,
                        options: []
                    }]
                )
            );
            await wallets.rechargeSchainWallet(schain3Hash, {value: schainWalletValue});
            await skaleDKG.setSuccessfulDKGPublic(schain3Hash);

            await skaleManager.connect(nodeAddress1).createNode(
                8545, // port
                0, // nonce
                "0x7f0000fe", // ip
                "0x7f0000fe", // public ip
                getPublicKey(nodeAddress1), // public key
                "D2-fe", // name
                "some.domain.name");

            let leavingNodeIndex = 0;
            for (let index = 0; index < 17; ++index) {
                const numberOfSchains = (await schainsInternal.getActiveSchains(index)).length;
                if (numberOfSchains == 3) {
                    leavingNodeIndex = index;
                    break;
                }
            }

            await nodes.initExit(leavingNodeIndex);
            await skaleManager.deleteSchainByRoot(schain2Name);
            await skaleManager.connect(nodeAddress1).nodeExit(leavingNodeIndex);
            await skaleManager.connect(nodeAddress1).nodeExit(leavingNodeIndex);

            await skaleDKG.setSuccessfulDKGPublic(schainHash);
            await skaleDKG.setSuccessfulDKGPublic(schain3Hash);

            await nodes.isNodeLeft(leavingNodeIndex).should.eventually.be.true;

            const [ slots ] = await schainsInternal.schainTypes(schainType);

            const numberOfNodes = (await nodes.getNumberOfNodes()).toNumber();
            for(let i = 0; i < numberOfNodes; i++) {
                if (i !== leavingNodeIndex) {
                    const numberOfSchains = (await schainsInternal.getActiveSchains(i)).length;
                    expect((await nodes.spaceOfNodes(i)).freeSpace).to.be.equal(128 - numberOfSchains * slots);
                }
            }
        });
    });
});
